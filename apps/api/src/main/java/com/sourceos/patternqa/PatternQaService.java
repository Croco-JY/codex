package com.sourceos.patternqa;

import static com.sourceos.patternqa.PatternQaModels.MAX;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.identity.IdentityService;
import com.sourceos.pattern.PatternQaContext;
import com.sourceos.patternqa.PatternQaModels.*;
import com.sourceos.shared.ValidationRules;
import java.sql.Types;
import java.util.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PatternQaService {
  private static final String COLUMNS =
      "id,pattern_revision_id,style_id,assessment_number,outcome,evidence_basis,artifact_id,reviewed_at,notes";
  private static final RowMapper<Assessment> ROW =
      (r, n) ->
          new Assessment(
              r.getObject("id", UUID.class),
              r.getObject("pattern_revision_id", UUID.class),
              r.getObject("style_id", UUID.class),
              r.getLong("assessment_number"),
              Outcome.valueOf(r.getString("outcome")),
              Basis.valueOf(r.getString("evidence_basis")),
              r.getObject("artifact_id", UUID.class),
              r.getTimestamp("reviewed_at").toInstant(),
              r.getString("notes"));
  private final JdbcClient jdbc;
  private final PatternQaContext patterns;
  private final IdentityService identities;
  private final AuditRecorder audit;

  public PatternQaService(
      JdbcClient jdbc, PatternQaContext patterns, IdentityService identities, AuditRecorder audit) {
    this.jdbc = jdbc;
    this.patterns = patterns;
    this.identities = identities;
    this.audit = audit;
  }

  private Optional<Assessment> latest(UUID revision, UUID style) {
    return jdbc.sql(
            "SELECT "
                + COLUMNS
                + " FROM pattern_qa_assessment WHERE pattern_revision_id=:revision AND"
                + " style_id=:style ORDER BY assessment_number DESC LIMIT 1")
        .param("revision", revision)
        .param("style", style)
        .query(ROW)
        .optional();
  }

  @Transactional(readOnly = true)
  public View read(UUID org, UUID project, UUID style, UUID pattern, UUID revision) {
    var c = patterns.read(org, project, style, pattern, revision);
    var a = latest(revision, style).orElse(null);
    return new View(
        pattern,
        revision,
        style,
        c.revisionNumber(),
        a == null ? State.UNREVIEWED : State.valueOf(a.outcome().name()),
        a);
  }

  @Transactional(readOnly = true)
  public Assessment exact(
      UUID org, UUID project, UUID style, UUID pattern, UUID revision, UUID id) {
    patterns.read(org, project, style, pattern, revision);
    return jdbc.sql(
            "SELECT "
                + COLUMNS
                + " FROM pattern_qa_assessment WHERE id=:id AND pattern_revision_id=:revision AND"
                + " style_id=:style")
        .param("id", id)
        .param("revision", revision)
        .param("style", style)
        .query(ROW)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  @Transactional(readOnly = true)
  public Page history(
      UUID org, UUID project, UUID style, UUID pattern, UUID revision, int limit, Long max) {
    patterns.read(org, project, style, pattern, revision);
    if (limit < 1 || limit > 100 || (max != null && (max < 0 || max > MAX)))
      throw ValidationRules.bad("Invalid QA history bounds");
    var rows =
        jdbc.sql(
                "SELECT"
                    + " id,pattern_revision_id,style_id,assessment_number,outcome,evidence_basis,artifact_id,reviewed_at"
                    + " FROM pattern_qa_assessment WHERE pattern_revision_id=:revision AND"
                    + " style_id=:style AND assessment_number<=:max ORDER BY assessment_number DESC"
                    + " LIMIT :limit")
            .param("revision", revision)
            .param("style", style)
            .param("max", max == null ? MAX : max)
            .param("limit", limit + 1)
            .query(
                (r, n) ->
                    new Summary(
                        r.getObject("id", UUID.class),
                        r.getObject("pattern_revision_id", UUID.class),
                        r.getObject("style_id", UUID.class),
                        r.getLong("assessment_number"),
                        Outcome.valueOf(r.getString("outcome")),
                        Basis.valueOf(r.getString("evidence_basis")),
                        r.getObject("artifact_id", UUID.class),
                        r.getTimestamp("reviewed_at").toInstant()))
            .list();
    return new Page(
        rows.stream().limit(limit).toList(),
        limit,
        rows.size() > limit ? rows.get(limit).assessmentNumber() : null);
  }

  @Transactional
  public Assessment create(
      UUID org, UUID project, UUID style, UUID pattern, UUID revision, Input raw, String request) {
    if (raw == null
        || raw.expectedLatestAssessmentNumber() == null
        || raw.expectedLatestAssessmentNumber() < 0
        || raw.expectedLatestAssessmentNumber() > MAX
        || raw.outcome() == null
        || raw.evidenceBasis() == null)
      throw ValidationRules.bad("Complete QA assessment required");
    String notes = QaText.notes(raw.notes());
    if ((raw.evidenceBasis() == Basis.METADATA_ONLY
            && (raw.artifactId() != null || raw.outcome() == Outcome.HUMAN_REVIEWED))
        || (raw.evidenceBasis() == Basis.READY_ARTIFACT && raw.artifactId() == null))
      throw ValidationRules.bad("Invalid QA evidence basis");
    var c = patterns.lockForAssessment(org, project, style, pattern, revision, raw.artifactId());
    var previous = latest(revision, style).orElse(null);
    long head = previous == null ? 0 : previous.assessmentNumber();
    if (head != raw.expectedLatestAssessmentNumber() || head == MAX)
      throw ValidationRules.conflict();
    var actor = identities.current();
    var next =
        jdbc.sql(
                "INSERT INTO"
                    + " pattern_qa_assessment(id,pattern_revision_id,style_id,assessment_number,outcome,evidence_basis,artifact_id,notes,reviewer_issuer,reviewer_subject)"
                    + " VALUES(:id,:revision,:style,:number,:outcome,:basis,:artifact,:notes,:issuer,:subject)"
                    + " RETURNING "
                    + COLUMNS)
            .param("id", UUID.randomUUID())
            .param("revision", revision)
            .param("style", style)
            .param("number", head + 1)
            .param("outcome", raw.outcome().name())
            .param("basis", raw.evidenceBasis().name())
            .param("artifact", raw.artifactId(), Types.OTHER)
            .param("notes", notes)
            .param("issuer", actor.issuer())
            .param("subject", actor.subject())
            .query(ROW)
            .single();
    audit.organizationChanged(
        org,
        "pattern_qa.assessment_recorded",
        "PatternQaAssessment",
        next.id(),
        request,
        Map.of("patternQaOutcome", previous == null ? "UNREVIEWED" : previous.outcome().name()),
        Map.of(
            "styleId",
            style,
            "patternId",
            pattern,
            "patternRevisionId",
            revision,
            "patternRevisionNumber",
            c.revisionNumber(),
            "patternQaAssessmentNumber",
            head + 1,
            "patternQaOutcome",
            next.outcome().name(),
            "patternQaEvidenceBasis",
            next.evidenceBasis().name()));
    return next;
  }
}
