package com.sourceos.pattern;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.identity.IdentityService;
import com.sourceos.measurement.MeasurementService;
import com.sourceos.pattern.PatternArtifactService.*;
import com.sourceos.shared.ValidationRules;
import com.sourceos.style.StyleService;
import java.sql.Types;
import java.util.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Separate proxied SQL phases; no file/storage dependency and no storage IO. */
@Component
class PatternArtifactTransactions {
  record Stored(View view, UUID object, String hash) {}

  record Reservation(PatternService.RevisionView revision, Stored stored) {}

  private static final String COLUMNS =
      "a.id,a.pattern_revision_id,r.pattern_id,a.style_id,a.storage_object_id,a.declared_format,a.display_name,a.size_bytes,a.sha256,a.state,a.failure_code,a.created_at,a.updated_at";
  private static final RowMapper<Stored> ROW =
      (r, n) ->
          new Stored(
              new View(
                  r.getObject("id", UUID.class),
                  r.getObject("pattern_revision_id", UUID.class),
                  r.getObject("pattern_id", UUID.class),
                  r.getObject("style_id", UUID.class),
                  PatternArtifactProbe.Format.valueOf(r.getString("declared_format")),
                  r.getString("display_name"),
                  r.getLong("size_bytes"),
                  State.valueOf(r.getString("state")),
                  r.getString("failure_code"),
                  r.getTimestamp("created_at").toInstant(),
                  r.getTimestamp("updated_at").toInstant()),
              r.getObject("storage_object_id", UUID.class),
              r.getString("sha256"));
  private final JdbcClient jdbc;
  private final StyleService styles;
  private final MeasurementService measurements;
  private final IdentityService identities;
  private final AuditRecorder audit;

  PatternArtifactTransactions(
      JdbcClient jdbc,
      StyleService styles,
      MeasurementService measurements,
      IdentityService identities,
      AuditRecorder audit) {
    this.jdbc = jdbc;
    this.styles = styles;
    this.measurements = measurements;
    this.identities = identities;
    this.audit = audit;
  }

  private void parents(UUID org, UUID project, UUID style) {
    var c = styles.lockContextForWrite(org, project, style);
    if (c.projectStatus() != StyleService.ParentStatus.ACTIVE
        || c.styleStatus() != StyleService.Status.ACTIVE) throw ValidationRules.conflict();
  }

  private void pattern(UUID style, UUID pattern, boolean write) {
    var status =
        jdbc.sql(
                "SELECT status FROM pattern WHERE id=:id AND style_id=:style"
                    + (write ? " FOR UPDATE" : ""))
            .param("id", pattern)
            .param("style", style)
            .query(String.class)
            .optional()
            .orElseThrow(ValidationRules::missing);
    if (write && !status.equals("ACTIVE")) throw ValidationRules.conflict();
  }

  private void revision(UUID style, UUID pattern, UUID revision) {
    if (!jdbc.sql(
            "SELECT EXISTS(SELECT 1 FROM pattern_revision WHERE id=:id AND pattern_id=:pattern AND"
                + " style_id=:style)")
        .param("id", revision)
        .param("pattern", pattern)
        .param("style", style)
        .query(Boolean.class)
        .single()) throw ValidationRules.missing();
  }

  private Stored stored(UUID style, UUID pattern, UUID revision, boolean lock) {
    return jdbc.sql(
            "SELECT "
                + COLUMNS
                + " FROM pattern_artifact a JOIN pattern_revision r ON r.id=a.pattern_revision_id"
                + " WHERE a.pattern_revision_id=:revision AND a.style_id=:style AND"
                + " r.pattern_id=:pattern"
                + (lock ? " FOR UPDATE OF a" : ""))
        .param("revision", revision)
        .param("style", style)
        .param("pattern", pattern)
        .query(ROW)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  @Transactional
  public void preflight(UUID org, UUID project, UUID style, UUID pattern, Input input) {
    parents(org, project, style);
    pattern(style, pattern, false);
    String status =
        jdbc.sql("SELECT status FROM pattern WHERE id=:id AND style_id=:style")
            .param("id", pattern)
            .param("style", style)
            .query(String.class)
            .single();
    if (!status.equals("ACTIVE")) throw ValidationRules.conflict();
    if (input.measurementRevisionId() != null)
      measurements.referenceContext(org, project, style, input.measurementRevisionId());
  }

  @Transactional
  public Reservation reserve(
      UUID org,
      UUID project,
      UUID style,
      UUID pattern,
      Input raw,
      long size,
      String hash,
      String request) {
    var input = PatternArtifactService.checked(raw);
    parents(org, project, style);
    if (input.measurementRevisionId() != null)
      measurements.referenceContext(org, project, style, input.measurementRevisionId());
    pattern(style, pattern, true);
    long latest =
        jdbc.sql(
                "SELECT revision_number FROM pattern_revision WHERE pattern_id=:id ORDER BY"
                    + " revision_number DESC LIMIT 1")
            .param("id", pattern)
            .query(Long.class)
            .single();
    if (latest != input.expectedLatestRevisionNumber() || latest == PatternService.MAX)
      throw ValidationRules.conflict();
    UUID id = UUID.randomUUID();
    var actor = identities.current();
    var r =
        jdbc.sql(
                "INSERT INTO"
                    + " pattern_revision(id,pattern_id,style_id,revision_number,name,purpose,measurement_revision_id,created_by_issuer,created_by_subject,artifact_expected)"
                    + " VALUES(:id,:pattern,:style,:number,:name,:purpose,:pin,:issuer,:subject,true)"
                    + " RETURNING created_at")
            .param("id", id)
            .param("pattern", pattern)
            .param("style", style)
            .param("number", latest + 1)
            .param("name", input.name())
            .param("purpose", input.purpose(), Types.VARCHAR)
            .param("pin", input.measurementRevisionId(), Types.OTHER)
            .param("issuer", actor.issuer())
            .param("subject", actor.subject())
            .query(
                (q, n) ->
                    new PatternService.RevisionView(
                        id,
                        pattern,
                        style,
                        latest + 1,
                        input.name(),
                        input.purpose(),
                        input.measurementRevisionId(),
                        q.getTimestamp("created_at").toInstant()))
            .single();
    jdbc.sql(
            "INSERT INTO"
                + " pattern_artifact(id,pattern_revision_id,style_id,storage_object_id,declared_format,display_name,size_bytes,sha256,state)"
                + " VALUES(:id,:revision,:style,:object,:format,:name,:size,:hash,'PENDING')")
        .param("id", UUID.randomUUID())
        .param("revision", id)
        .param("style", style)
        .param("object", UUID.randomUUID())
        .param("format", input.declaredFormat().name())
        .param("name", input.displayName())
        .param("size", size)
        .param("hash", hash)
        .update();
    var state = new LinkedHashMap<String, Object>();
    state.put("styleId", style);
    state.put("patternId", pattern);
    state.put("patternRevisionNumber", latest + 1);
    if (input.measurementRevisionId() != null)
      state.put("measurementRevisionId", input.measurementRevisionId());
    audit.organizationChanged(
        org, "pattern_revision.created", "PatternRevision", id, request, null, state);
    var s = stored(style, pattern, id, false);
    record(org, "upload_started", null, s.view(), request);
    return new Reservation(r, s);
  }

  @Transactional(readOnly = true)
  public Stored read(UUID org, UUID project, UUID style, UUID pattern, UUID revision) {
    styles.readContext(org, project, style);
    pattern(style, pattern, false);
    revision(style, pattern, revision);
    return stored(style, pattern, revision, false);
  }

  @Transactional
  public View finish(
      UUID org,
      UUID project,
      UUID style,
      UUID pattern,
      UUID revision,
      State state,
      Failure failure,
      String request) {
    parents(org, project, style);
    pattern(style, pattern, true);
    revision(style, pattern, revision);
    var before = stored(style, pattern, revision, true);
    if (before.view().state() != State.PENDING
        || (state != State.READY && state != State.FAILED)
        || (state == State.READY && failure != null)
        || (state == State.FAILED && failure == null)) throw ValidationRules.conflict();
    jdbc.sql(
            "UPDATE pattern_artifact SET"
                + " state=:state,failure_code=:failure,version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at+interval"
                + " '1 microsecond') WHERE id=:id")
        .param("id", before.view().id())
        .param("state", state.name())
        .param("failure", failure == null ? null : failure.name(), Types.VARCHAR)
        .update();
    var after = stored(style, pattern, revision, false).view();
    record(org, state == State.READY ? "ready" : "failed", before.view(), after, request);
    return after;
  }

  private Map<String, Object> state(View v) {
    var s = new LinkedHashMap<String, Object>();
    s.put("styleId", v.styleId());
    s.put("patternId", v.patternId());
    s.put("patternRevisionId", v.patternRevisionId());
    s.put("patternArtifactState", v.state().name());
    s.put("patternArtifactFormat", v.declaredFormat().name());
    s.put("sizeBytes", v.sizeBytes());
    if (v.failureCode() != null) s.put("patternArtifactFailureCode", v.failureCode());
    return s;
  }

  private void record(UUID org, String action, View before, View after, String request) {
    audit.organizationChanged(
        org,
        "pattern_artifact." + action,
        "PatternArtifact",
        after.id(),
        request,
        before == null ? null : state(before),
        state(after));
  }
}
