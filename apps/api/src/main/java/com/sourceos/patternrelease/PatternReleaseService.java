package com.sourceos.patternrelease;

import static com.sourceos.patternrelease.ReleaseModels.*;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.authorization.OrganizationAuthorization;
import com.sourceos.identity.IdentityService;
import com.sourceos.organization.ReleaseOrganizationContext;
import com.sourceos.pattern.ReleasePatternContext;
import com.sourceos.shared.*;
import java.sql.Types;
import java.util.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class PatternReleaseService {
  private final JdbcClient jdbc;
  private final OrganizationAuthorization auth;
  private final IdentityService identities;
  private final ReleaseOrganizationContext organizations;
  private final ReleasePatternContext patterns;
  private final AuditRecorder audit;

  public PatternReleaseService(
      JdbcClient j,
      OrganizationAuthorization a,
      IdentityService i,
      ReleaseOrganizationContext o,
      ReleasePatternContext p,
      AuditRecorder audit) {
    jdbc = j;
    auth = a;
    identities = i;
    organizations = o;
    patterns = p;
    this.audit = audit;
  }

  private static final String COLUMNS =
      "r.id,r.consent_id,r.source_organization_id,r.recipient_organization_id,r.project_id,r.style_id,r.pattern_id,r.pattern_revision_id,r.pattern_revision_number,r.artifact_id,r.declared_format,r.display_name,r.size_bytes,r.purpose,r.released_at,r.expires_at";
  private static final RowMapper<SourceSummary> SUMMARY =
      (r, n) ->
          new SourceSummary(
              r.getObject("id", UUID.class),
              r.getObject("consent_id", UUID.class),
              r.getObject("source_organization_id", UUID.class),
              r.getObject("recipient_organization_id", UUID.class),
              r.getObject("project_id", UUID.class),
              r.getObject("style_id", UUID.class),
              r.getObject("pattern_id", UUID.class),
              r.getObject("pattern_revision_id", UUID.class),
              r.getLong("pattern_revision_number"),
              r.getObject("artifact_id", UUID.class),
              r.getString("declared_format"),
              r.getString("display_name"),
              r.getLong("size_bytes"),
              r.getString("purpose"),
              r.getTimestamp("released_at").toInstant(),
              r.getTimestamp("expires_at").toInstant());

  private SourceSummary exact(
      UUID source, UUID project, UUID style, UUID pattern, UUID revision, UUID id) {
    return jdbc.sql(
            "SELECT "
                + COLUMNS
                + " FROM pattern_release r WHERE r.id=:id AND r.source_organization_id=:org AND"
                + " r.project_id=:project AND r.style_id=:style AND r.pattern_id=:pattern AND"
                + " r.pattern_revision_id=:revision")
        .param("id", id)
        .param("org", source)
        .param("project", project)
        .param("style", style)
        .param("pattern", pattern)
        .param("revision", revision)
        .query(SUMMARY)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  private SourceView view(SourceSummary r) {
    return jdbc.sql(
            "SELECT event_number,kind FROM pattern_release_event WHERE release_id=:id ORDER BY"
                + " event_number DESC LIMIT 1")
        .param("id", r.id())
        .query((rs, n) -> new SourceView(r, rs.getLong(1), EventKind.valueOf(rs.getString(2))))
        .single();
  }

  @Transactional(readOnly = true)
  public SourceView read(UUID org, UUID project, UUID style, UUID pattern, UUID revision, UUID id) {
    patterns.source(org, project, style, pattern, revision, false);
    return view(exact(org, project, style, pattern, revision, id));
  }

  @Transactional(readOnly = true)
  public SourcePage list(
      UUID org, UUID project, UUID style, UUID pattern, UUID revision, int limit, String cursor) {
    patterns.source(org, project, style, pattern, revision, false);
    var filter = List.of("source-releases", org, project, style, pattern, revision);
    var anchor = Keysets.anchor(cursor, filter, limit);
    var rows =
        jdbc.sql(
                "SELECT "
                    + COLUMNS
                    + " FROM pattern_release r WHERE r.source_organization_id=:org AND"
                    + " r.project_id=:project AND r.style_id=:style AND r.pattern_id=:pattern AND"
                    + " r.pattern_revision_id=:revision AND (CAST(:at AS timestamptz) IS NULL OR"
                    + " (r.released_at,r.id)<(:at,:after)) ORDER BY r.released_at DESC,r.id DESC"
                    + " LIMIT :limit")
            .param("org", org)
            .param("project", project)
            .param("style", style)
            .param("pattern", pattern)
            .param("revision", revision)
            .param("at", Keysets.time(anchor.at()), Types.TIMESTAMP_WITH_TIMEZONE)
            .param("after", anchor.id(), Types.OTHER)
            .param("limit", limit + 1)
            .query(SUMMARY)
            .list();
    var p = Keysets.page(rows, limit, filter, SourceSummary::releasedAt, SourceSummary::id);
    return new SourcePage(p.items(), limit, p.nextCursor());
  }

  @Transactional(readOnly = true)
  public EventPage events(
      UUID org,
      UUID project,
      UUID style,
      UUID pattern,
      UUID revision,
      UUID id,
      int limit,
      Long max) {
    read(org, project, style, pattern, revision, id);
    Keysets.limit(limit);
    if (max != null && (max < 0 || max > MAX))
      throw ValidationRules.bad("Invalid event history bound");
    var rows =
        jdbc.sql(
                "SELECT id,release_id,event_number,kind,occurred_at FROM pattern_release_event"
                    + " WHERE release_id=:id AND event_number<=:max ORDER BY event_number DESC"
                    + " LIMIT :limit")
            .param("id", id)
            .param("max", max == null ? MAX : max)
            .param("limit", limit + 1)
            .query(
                (r, n) ->
                    new EventSummary(
                        r.getObject(1, UUID.class),
                        r.getObject(2, UUID.class),
                        r.getLong(3),
                        EventKind.valueOf(r.getString(4)),
                        r.getTimestamp(5).toInstant()))
            .list();
    return new EventPage(
        rows.stream().limit(limit).toList(),
        limit,
        rows.size() > limit ? rows.get(limit).eventNumber() : null);
  }

  @Transactional
  public SourceView create(
      UUID source,
      UUID project,
      UUID style,
      UUID pattern,
      UUID revision,
      CreateInput input,
      String requestId) {
    auth.requireWrite(source);
    if (input == null
        || input.consentId() == null
        || input.expectedLatestConsentEventNumber() == null
        || input.expectedLatestConsentEventNumber() < 0
        || input.expectedLatestConsentEventNumber() > MAX)
      throw ValidationRules.bad("Consent and expected head required");
    String purpose = ReleaseText.purpose(input.purpose());
    int duration = input.accessDurationSeconds() == null ? 86400 : input.accessDurationSeconds();
    if (duration < 1 || duration > 86400) throw ValidationRules.bad("Invalid access duration");
    UUID recipient =
        jdbc.sql(
                "SELECT recipient_organization_id FROM pattern_release_consent WHERE id=:id AND"
                    + " intended_source_organization_id=:source")
            .param("id", input.consentId())
            .param("source", source)
            .query(UUID.class)
            .optional()
            .orElseThrow(ValidationRules::missing);
    var roots = organizations.lockSource(source, recipient, true);
    var c = patterns.source(source, project, style, pattern, revision, true);
    var artifact = c.artifact();
    if (artifact == null || !artifact.state().equals("READY")) throw ValidationRules.conflict();
    jdbc.sql(
            "SELECT id FROM pattern_release_consent WHERE id=:id AND"
                + " intended_source_organization_id=:source AND"
                + " recipient_organization_id=:recipient FOR UPDATE")
        .param("id", input.consentId())
        .param("source", source)
        .param("recipient", recipient)
        .query(UUID.class)
        .optional()
        .orElseThrow(ValidationRules::missing);
    var eligible =
        jdbc.sql(
                "SELECT e.event_number,e.kind,c.expires_at>clock_timestamp() AS unexpired FROM"
                    + " pattern_release_consent c JOIN LATERAL (SELECT event_number,kind FROM"
                    + " pattern_release_consent_event WHERE consent_id=c.id ORDER BY event_number"
                    + " DESC LIMIT 1) e ON true WHERE c.id=:id")
            .param("id", input.consentId())
            .query(
                (r, n) ->
                    r.getLong(1) == input.expectedLatestConsentEventNumber()
                        && r.getString(2).equals("ISSUED")
                        && r.getBoolean(3))
            .single();
    if (!eligible) throw ValidationRules.conflict();
    auth.requireWrite(source);
    UUID id = UUID.randomUUID();
    var actor = identities.current();
    jdbc.sql(
            "INSERT INTO"
                + " pattern_release(id,consent_id,source_organization_id,recipient_organization_id,project_id,style_id,pattern_id,pattern_revision_id,pattern_revision_number,artifact_id,storage_object_id,declared_format,display_name,size_bytes,sha256,purpose,access_duration_seconds,source_version,recipient_version,project_version,style_version,pattern_version,issuer,subject)"
                + " VALUES(:id,:consent,:source,:recipient,:project,:style,:pattern,:revision,:number,:artifact,:object,:format,:name,:bytes,:hash,:purpose,:duration,:sourceVersion,:recipientVersion,:projectVersion,:styleVersion,:patternVersion,:issuer,:subject)")
        .param("id", id)
        .param("consent", input.consentId())
        .param("source", source)
        .param("recipient", recipient)
        .param("project", project)
        .param("style", style)
        .param("pattern", pattern)
        .param("revision", revision)
        .param("number", c.revisionNumber())
        .param("artifact", artifact.id())
        .param("object", artifact.objectId())
        .param("format", artifact.format())
        .param("name", artifact.displayName())
        .param("bytes", artifact.bytes())
        .param("hash", artifact.sha256())
        .param("purpose", purpose)
        .param("duration", duration)
        .param("sourceVersion", roots.source().version())
        .param("recipientVersion", roots.recipient().version())
        .param("projectVersion", c.projectVersion())
        .param("styleVersion", c.styleVersion())
        .param("patternVersion", c.version())
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .update();
    releaseEvent(source, id, 1, "ACTIVATED");
    jdbc.sql(
            "INSERT INTO"
                + " pattern_release_consent_event(id,consent_id,recipient_organization_id,event_number,kind,release_id,actor_organization_id,issuer,subject)"
                + " VALUES(:event,:consent,:recipient,2,'CONSUMED',:release,:source,:issuer,:subject)")
        .param("event", UUID.randomUUID())
        .param("consent", input.consentId())
        .param("recipient", recipient)
        .param("release", id)
        .param("source", source)
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .update();
    audit.organizationChanged(
        source,
        "pattern_release.created",
        "PatternRelease",
        id,
        requestId,
        null,
        Map.of(
            "patternReleaseConsentId",
            input.consentId(),
            "recipientOrganizationId",
            recipient,
            "patternRevisionId",
            revision,
            "patternRevisionNumber",
            c.revisionNumber(),
            "patternReleaseEventNumber",
            1,
            "state",
            "ACTIVATED"));
    return view(exact(source, project, style, pattern, revision, id));
  }

  @Transactional
  public SourceView revoke(
      UUID source,
      UUID project,
      UUID style,
      UUID pattern,
      UUID revision,
      UUID id,
      EventCommand input,
      String requestId) {
    auth.requireWrite(source);
    ReleaseConsentService.expected(input);
    // Scoped receipt resolution is read-only before ordered write locks.
    var r = exact(source, project, style, pattern, revision, id);
    organizations.lockSource(source, r.recipientOrganizationId(), false);
    patterns.source(source, project, style, pattern, revision, true);
    jdbc.sql("SELECT id FROM pattern_release_consent WHERE id=:id FOR UPDATE")
        .param("id", r.consentId())
        .query(UUID.class)
        .single();
    jdbc.sql(
            "SELECT id FROM pattern_release WHERE id=:id AND source_organization_id=:org FOR"
                + " UPDATE")
        .param("id", id)
        .param("org", source)
        .query(UUID.class)
        .single();
    // Membership may have been revoked while any preceding row lock was awaited.
    auth.requireWrite(source);
    var previous = view(r);
    if (previous.latestEventNumber() != input.expectedLatestEventNumber())
      throw ValidationRules.conflict();
    if (previous.lifecycle() == EventKind.REVOKED) return previous;
    releaseEvent(source, id, previous.latestEventNumber() + 1, "REVOKED");
    audit.organizationChanged(
        source,
        "pattern_release.revoked",
        "PatternRelease",
        id,
        requestId,
        Map.of("state", previous.lifecycle().name()),
        Map.of("state", "REVOKED", "patternReleaseEventNumber", previous.latestEventNumber() + 1));
    return view(r);
  }

  private void releaseEvent(UUID source, UUID release, long number, String kind) {
    var actor = identities.current();
    jdbc.sql(
            "INSERT INTO"
                + " pattern_release_event(id,release_id,source_organization_id,event_number,kind,actor_organization_id,issuer,subject)"
                + " VALUES(:id,:release,:source,:number,:kind,:source,:issuer,:subject)")
        .param("id", UUID.randomUUID())
        .param("release", release)
        .param("source", source)
        .param("number", number)
        .param("kind", kind)
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .update();
  }
}
