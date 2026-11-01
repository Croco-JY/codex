package com.sourceos.patternrelease;

import static com.sourceos.patternrelease.ReleaseModels.*;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.authorization.OrganizationAuthorization;
import com.sourceos.identity.IdentityService;
import com.sourceos.organization.ReleaseOrganizationContext;
import com.sourceos.shared.*;
import java.sql.Types;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class ReleaseConsentService {
  private final JdbcClient jdbc;
  private final OrganizationAuthorization auth;
  private final ReleaseOrganizationContext organizations;
  private final IdentityService identities;
  private final AuditRecorder audit;

  public ReleaseConsentService(
      JdbcClient j,
      OrganizationAuthorization a,
      ReleaseOrganizationContext o,
      IdentityService i,
      AuditRecorder audit) {
    jdbc = j;
    auth = a;
    organizations = o;
    identities = i;
    this.audit = audit;
  }

  private static final String SELECT =
      "SELECT"
          + " c.id,c.recipient_organization_id,c.intended_source_organization_id,c.issued_at,c.expires_at,e.event_number,e.kind,(SELECT"
          + " release_id FROM pattern_release_consent_event x WHERE x.consent_id=c.id AND"
          + " x.kind='CONSUMED') AS consumed_release_id,clock_timestamp() AS wall FROM"
          + " pattern_release_consent c JOIN LATERAL (SELECT event_number,kind FROM"
          + " pattern_release_consent_event WHERE consent_id=c.id ORDER BY event_number DESC LIMIT"
          + " 1) e ON true ";
  private static final RowMapper<ConsentView> ROW =
      (rs, n) -> {
        String kind = rs.getString("kind");
        Instant expires = rs.getTimestamp("expires_at").toInstant();
        var state =
            kind.equals("ISSUED") && !rs.getTimestamp("wall").toInstant().isBefore(expires)
                ? ConsentState.EXPIRED
                : ConsentState.valueOf(kind);
        return new ConsentView(
            rs.getObject("id", UUID.class),
            rs.getObject("recipient_organization_id", UUID.class),
            rs.getObject("intended_source_organization_id", UUID.class),
            rs.getTimestamp("issued_at").toInstant(),
            expires,
            state,
            rs.getLong("event_number"),
            rs.getObject("consumed_release_id", UUID.class));
      };

  private ConsentView find(UUID org, UUID id) {
    return jdbc.sql(SELECT + "WHERE c.id=:id AND c.recipient_organization_id=:org")
        .param("id", id)
        .param("org", org)
        .query(ROW)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  @Transactional(readOnly = true)
  public ConsentView read(UUID org, UUID id) {
    auth.requireWrite(org);
    return find(org, id);
  }

  @Transactional(readOnly = true)
  public ConsentPage list(UUID org, int limit, String cursor) {
    auth.requireWrite(org);
    var filter = List.of("release-consents", org);
    var anchor = Keysets.anchor(cursor, filter, limit);
    var rows =
        jdbc.sql(
                SELECT
                    + "WHERE c.recipient_organization_id=:org AND (CAST(:at AS timestamptz) IS NULL"
                    + " OR (c.issued_at,c.id)<(:at,:after)) ORDER BY c.issued_at DESC,c.id DESC"
                    + " LIMIT :limit")
            .param("org", org)
            .param("at", Keysets.time(anchor.at()), Types.TIMESTAMP_WITH_TIMEZONE)
            .param("after", anchor.id(), Types.OTHER)
            .param("limit", limit + 1)
            .query(ROW)
            .list();
    var p = Keysets.page(rows, limit, filter, ConsentView::issuedAt, ConsentView::id);
    return new ConsentPage(p.items(), limit, p.nextCursor());
  }

  @Transactional
  public ConsentView issue(UUID recipient, ConsentCreateInput input, String requestId) {
    if (input == null
        || input.sourceOrganizationId() == null
        || input.sourceOrganizationId().equals(recipient))
      throw ValidationRules.bad("Distinct source Organization required");
    organizations.lockRecipient(recipient);
    var actor = identities.current();
    UUID id = UUID.randomUUID();
    jdbc.sql(
            "INSERT INTO"
                + " pattern_release_consent(id,recipient_organization_id,intended_source_organization_id,issuer,subject)"
                + " VALUES(:id,:org,:source,:issuer,:subject)")
        .param("id", id)
        .param("org", recipient)
        .param("source", input.sourceOrganizationId())
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .update();
    event(recipient, id, 1, "ISSUED");
    audit.organizationChanged(
        recipient,
        "pattern_release_consent.issued",
        "PatternReleaseConsent",
        id,
        requestId,
        null,
        Map.of("state", "ISSUED", "patternReleaseConsentEventNumber", 1));
    return find(recipient, id);
  }

  @Transactional
  public ConsentView withdraw(UUID recipient, UUID id, EventCommand input, String requestId) {
    expected(input);
    organizations.lockRecipient(recipient);
    jdbc.sql(
            "SELECT id FROM pattern_release_consent WHERE id=:id AND recipient_organization_id=:org"
                + " FOR UPDATE")
        .param("id", id)
        .param("org", recipient)
        .query(UUID.class)
        .optional()
        .orElseThrow(ValidationRules::missing);
    // The consent wait follows the Organization check; authorize at the write boundary.
    auth.requireWrite(recipient);
    var current = find(recipient, id);
    if (current.latestEventNumber() != input.expectedLatestEventNumber())
      throw ValidationRules.conflict();
    if (current.state() == ConsentState.WITHDRAWN) return current;
    if (current.latestEventNumber() == MAX) throw ValidationRules.conflict();
    event(recipient, id, current.latestEventNumber() + 1, "WITHDRAWN");
    audit.organizationChanged(
        recipient,
        "pattern_release_consent.withdrawn",
        "PatternReleaseConsent",
        id,
        requestId,
        Map.of("state", current.state().name()),
        Map.of(
            "state",
            "WITHDRAWN",
            "patternReleaseConsentEventNumber",
            current.latestEventNumber() + 1));
    return find(recipient, id);
  }

  private void event(UUID org, UUID consent, long head, String kind) {
    var actor = identities.current();
    jdbc.sql(
            "INSERT INTO"
                + " pattern_release_consent_event(id,consent_id,recipient_organization_id,event_number,kind,actor_organization_id,issuer,subject)"
                + " VALUES(:id,:consent,:org,:number,:kind,:org,:issuer,:subject)")
        .param("id", UUID.randomUUID())
        .param("consent", consent)
        .param("org", org)
        .param("number", head)
        .param("kind", kind)
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .update();
  }

  static void expected(EventCommand input) {
    if (input == null
        || input.expectedLatestEventNumber() == null
        || input.expectedLatestEventNumber() < 0
        || input.expectedLatestEventNumber() > MAX)
      throw ValidationRules.bad("Expected event number required");
  }
}
