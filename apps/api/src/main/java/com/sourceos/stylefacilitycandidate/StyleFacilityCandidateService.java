package com.sourceos.stylefacilitycandidate;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.facility.FacilityService;
import com.sourceos.shared.ValidationRules;
import com.sourceos.style.StyleService;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.*;
import tools.jackson.databind.*;
import tools.jackson.databind.annotation.JsonDeserialize;

@Service
public class StyleFacilityCandidateService {
  @Schema(
      name = "StyleFacilityCandidateInput",
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
      requiredProperties = {"facilityId"})
  public record Input(@NotNull @JsonDeserialize(using = StrictUuid.class) UUID facilityId) {}

  @Schema(
      name = "StyleFacilityCandidateView",
      requiredProperties = {"id", "styleId", "facilityId", "createdAt"})
  public record View(UUID id, UUID styleId, UUID facilityId, Instant createdAt) {}

  @Schema(
      name = "StyleFacilityCandidatePage",
      requiredProperties = {"items", "limit", "offset", "hasMore"})
  public record Page(List<View> items, int limit, int offset, boolean hasMore) {}

  static class StrictUuid extends ValueDeserializer<UUID> {
    @Override
    public UUID deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)
          || !p.getString()
              .matches(
                  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
        throw ValidationRules.bad("UUID required");
      return UUID.fromString(p.getString());
    }
  }

  private static final String COLUMNS = "id,style_id,facility_id,created_at";
  private static final RowMapper<View> ROW =
      (r, n) ->
          new View(
              r.getObject("id", UUID.class), r.getObject("style_id", UUID.class),
              r.getObject("facility_id", UUID.class), r.getTimestamp("created_at").toInstant());
  private final JdbcClient jdbc;
  private final StyleService styles;
  private final FacilityService facilities;
  private final AuditRecorder audit;

  public StyleFacilityCandidateService(
      JdbcClient jdbc, StyleService styles, FacilityService facilities, AuditRecorder audit) {
    this.jdbc = jdbc;
    this.styles = styles;
    this.facilities = facilities;
    this.audit = audit;
  }

  private void active(UUID org, UUID project, UUID style) {
    var context = styles.lockContextForWrite(org, project, style);
    if (context.projectStatus() != StyleService.ParentStatus.ACTIVE
        || context.styleStatus() != StyleService.Status.ACTIVE) throw ValidationRules.conflict();
  }

  private Map<String, Object> state(View v) {
    return Map.of("styleId", v.styleId(), "facilityId", v.facilityId());
  }

  @Transactional(readOnly = true)
  public Page list(UUID org, UUID project, UUID style, int limit, int offset) {
    styles.readContext(org, project, style);
    ValidationRules.page(limit, offset);
    var rows =
        jdbc.sql(
                "SELECT "
                    + COLUMNS
                    + " FROM style_facility_candidate WHERE style_id=:style ORDER BY created_at"
                    + " DESC,id DESC LIMIT :limit OFFSET :offset")
            .param("style", style)
            .param("limit", limit + 1)
            .param("offset", offset)
            .query(ROW)
            .list();
    return new Page(
        List.copyOf(rows.subList(0, Math.min(limit, rows.size()))),
        limit,
        offset,
        rows.size() > limit);
  }

  @Transactional
  public View add(UUID org, UUID project, UUID style, Input input, String requestId) {
    active(org, project, style);
    if (input.facilityId() == null) throw ValidationRules.bad("Facility required");
    facilities.lockActiveReference(input.facilityId());
    var view =
        jdbc.sql(
                "INSERT INTO style_facility_candidate(id,style_id,facility_id)"
                    + " VALUES(:id,:style,:facility) ON CONFLICT ON CONSTRAINT"
                    + " style_facility_candidate_scope_uq DO NOTHING RETURNING "
                    + COLUMNS)
            .param("id", UUID.randomUUID())
            .param("style", style)
            .param("facility", input.facilityId())
            .query(ROW)
            .optional()
            .orElseThrow(ValidationRules::conflict);
    audit.organizationChanged(
        org,
        "facility_candidate.added",
        "StyleFacilityCandidate",
        view.id(),
        requestId,
        null,
        state(view));
    return view;
  }

  @Transactional
  public void remove(UUID org, UUID project, UUID style, UUID candidate, String requestId) {
    active(org, project, style);
    var view =
        jdbc.sql(
                "DELETE FROM style_facility_candidate WHERE style_id=:style AND id=:id RETURNING "
                    + COLUMNS)
            .param("style", style)
            .param("id", candidate)
            .query(ROW)
            .optional()
            .orElseThrow(ValidationRules::missing);
    audit.organizationChanged(
        org,
        "facility_candidate.removed",
        "StyleFacilityCandidate",
        view.id(),
        requestId,
        state(view),
        null);
  }
}
