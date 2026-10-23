package com.sourceos.stylematerialselection;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.material.MaterialService;
import com.sourceos.materiallisting.ListingService;
import com.sourceos.shared.ValidationRules;
import com.sourceos.style.StyleService;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import java.sql.Types;
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
public class StyleMaterialSelectionService {
  @Schema(
      name = "StyleMaterialSelectionInput",
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
      requiredProperties = {"materialId"})
  public record Input(
      @NotNull @JsonDeserialize(using = StrictUuid.class) UUID materialId,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          @JsonDeserialize(using = StrictUuid.class)
          UUID variantId,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          @JsonDeserialize(using = StrictUuid.class)
          UUID listingId) {}

  @Schema(
      name = "StyleMaterialSelectionView",
      requiredProperties = {"id", "styleId", "materialId", "variantId", "listingId", "createdAt"})
  public record View(
      UUID id,
      UUID styleId,
      UUID materialId,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          UUID variantId,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          UUID listingId,
      Instant createdAt) {}

  @Schema(
      name = "StyleMaterialSelectionPage",
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

  private static final String COLUMNS = "id,style_id,material_id,variant_id,listing_id,created_at";
  private static final RowMapper<View> ROW =
      (r, n) ->
          new View(
              r.getObject("id", UUID.class),
              r.getObject("style_id", UUID.class),
              r.getObject("material_id", UUID.class),
              r.getObject("variant_id", UUID.class),
              r.getObject("listing_id", UUID.class),
              r.getTimestamp("created_at").toInstant());
  private final JdbcClient jdbc;
  private final StyleService styles;
  private final MaterialService materials;
  private final ListingService listings;
  private final AuditRecorder audit;

  public StyleMaterialSelectionService(
      JdbcClient jdbc,
      StyleService styles,
      MaterialService materials,
      ListingService listings,
      AuditRecorder audit) {
    this.jdbc = jdbc;
    this.styles = styles;
    this.materials = materials;
    this.listings = listings;
    this.audit = audit;
  }

  private void active(UUID org, UUID project, UUID style) {
    var c = styles.lockContextForWrite(org, project, style);
    if (c.projectStatus() != StyleService.ParentStatus.ACTIVE
        || c.styleStatus() != StyleService.Status.ACTIVE) throw ValidationRules.conflict();
  }

  private Map<String, Object> state(View v) {
    var s = new LinkedHashMap<String, Object>();
    s.put("styleId", v.styleId());
    s.put("materialId", v.materialId());
    s.put("variantId", v.variantId());
    s.put("listingId", v.listingId());
    return s;
  }

  @Transactional(readOnly = true)
  public Page list(UUID org, UUID project, UUID style, int limit, int offset) {
    styles.readContext(org, project, style);
    ValidationRules.page(limit, offset);
    var rows =
        jdbc.sql(
                "SELECT "
                    + COLUMNS
                    + " FROM style_material_selection WHERE style_id=:style ORDER BY created_at"
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
    if (input.materialId() == null) throw ValidationRules.bad("Material required");
    materials.lockActiveReference(input.materialId());
    if (input.variantId() != null)
      materials.lockActiveVariantReference(input.variantId(), input.materialId());
    if (input.listingId() != null)
      listings.lockActiveReference(input.listingId(), input.materialId());
    var v =
        jdbc.sql(
                "INSERT INTO"
                    + " style_material_selection(id,style_id,material_id,variant_id,listing_id)"
                    + " VALUES(:id,:style,:material,:variant,:listing) ON CONFLICT ON CONSTRAINT"
                    + " style_material_selection_scope_uq DO NOTHING RETURNING "
                    + COLUMNS)
            .param("id", UUID.randomUUID())
            .param("style", style)
            .param("material", input.materialId())
            .param("variant", input.variantId(), Types.OTHER)
            .param("listing", input.listingId(), Types.OTHER)
            .query(ROW)
            .optional()
            .orElseThrow(ValidationRules::conflict);
    audit.organizationChanged(
        org,
        "material_selection.added",
        "StyleMaterialSelection",
        v.id(),
        requestId,
        null,
        state(v));
    return v;
  }

  @Transactional
  public void remove(UUID org, UUID project, UUID style, UUID selection, String requestId) {
    active(org, project, style);
    var v =
        jdbc.sql(
                "DELETE FROM style_material_selection WHERE style_id=:style AND id=:id RETURNING "
                    + COLUMNS)
            .param("style", style)
            .param("id", selection)
            .query(ROW)
            .optional()
            .orElseThrow(ValidationRules::missing);
    audit.organizationChanged(
        org,
        "material_selection.removed",
        "StyleMaterialSelection",
        v.id(),
        requestId,
        state(v),
        null);
  }
}
