package com.sourceos.styledevelopmentreference;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.shared.ValidationRules;
import com.sourceos.style.StyleService;
import com.sourceos.styledevelopmentreference.StyleDevelopmentReferenceService.*;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class StyleDevelopmentReferenceTransactions {
  private final JdbcClient jdbc;
  private final StyleService styles;
  private final AuditRecorder audit;

  StyleDevelopmentReferenceTransactions(JdbcClient jdbc, StyleService styles, AuditRecorder audit) {
    this.jdbc = jdbc;
    this.styles = styles;
    this.audit = audit;
  }

  private void active(UUID org, UUID project, UUID style) {
    var c = styles.lockContextForWrite(org, project, style);
    if (c.projectStatus() != StyleService.ParentStatus.ACTIVE
        || c.styleStatus() != StyleService.Status.ACTIVE) throw ValidationRules.conflict();
  }

  private View locked(UUID style, UUID reference) {
    return jdbc.sql(
            "SELECT "
                + StyleDevelopmentReferenceService.COLUMNS
                + " FROM style_development_reference WHERE style_id=:style AND id=:id FOR UPDATE")
        .param("style", style)
        .param("id", reference)
        .query(StyleDevelopmentReferenceService.ROW)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  private Map<String, Object> state(View v) {
    return Map.of(
        "styleId",
        v.styleId(),
        "state",
        v.state().name(),
        "version",
        v.version(),
        "sizeBytes",
        v.sizeBytes());
  }

  private void record(UUID org, String action, View before, View after, String requestId) {
    audit.organizationChanged(
        org,
        "development_reference." + action,
        "StyleDevelopmentReference",
        after.id(),
        requestId,
        before == null ? null : state(before),
        state(after));
  }

  @Transactional
  public View reserve(
      UUID org, UUID project, UUID style, String name, long size, String requestId) {
    active(org, project, style);
    var v =
        jdbc.sql(
                "INSERT INTO"
                    + " style_development_reference(id,style_id,storage_object_id,display_name,media_type,size_bytes,state)"
                    + " VALUES(:id,:style,:object,:name,'application/octet-stream',:size,'PENDING')"
                    + " RETURNING "
                    + StyleDevelopmentReferenceService.COLUMNS)
            .param("id", UUID.randomUUID())
            .param("style", style)
            .param("object", UUID.randomUUID())
            .param("name", StyleDevelopmentReferenceService.safeName(name))
            .param("size", size)
            .query(StyleDevelopmentReferenceService.ROW)
            .single();
    record(org, "upload_started", null, v, requestId);
    return v;
  }

  private View transition(UUID org, View before, State state, String action, String requestId) {
    var v =
        jdbc.sql(
                "UPDATE style_development_reference SET"
                    + " state=:state,version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at+interval"
                    + " '1 microsecond') WHERE id=:id RETURNING "
                    + StyleDevelopmentReferenceService.COLUMNS)
            .param("state", state.name())
            .param("id", before.id())
            .query(StyleDevelopmentReferenceService.ROW)
            .single();
    record(org, action, before, v, requestId);
    return v;
  }

  @Transactional
  public View finish(
      UUID org, UUID project, UUID style, UUID reference, State state, String requestId) {
    active(org, project, style);
    var before = locked(style, reference);
    if (before.state() != State.PENDING || (state != State.READY && state != State.FAILED))
      throw ValidationRules.conflict();
    return transition(org, before, state, state == State.READY ? "ready" : "failed", requestId);
  }

  @Transactional
  public View detach(
      UUID org, UUID project, UUID style, UUID reference, long version, String requestId) {
    active(org, project, style);
    var before = locked(style, reference);
    if (before.state() == State.DETACHED || before.version() != version)
      throw ValidationRules.conflict();
    return transition(org, before, State.DETACHED, "detached", requestId);
  }
}
