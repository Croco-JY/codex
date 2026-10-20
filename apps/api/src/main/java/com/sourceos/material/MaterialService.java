package com.sourceos.material;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.authorization.PlatformAuthorization;
import com.sourceos.dataingestion.SourceService;
import com.sourceos.shared.*;
import com.sourceos.supplier.SupplierService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class MaterialService {
  public enum Type {
    FABRIC,
    LEATHER,
    LINING,
    INTERLINING,
    ZIPPER,
    BUTTON,
    SNAP,
    BUCKLE,
    THREAD,
    TAPE,
    LABEL,
    ELASTIC,
    FILLING,
    PACKAGING,
    OTHER
  }

  public enum Status {
    DRAFT,
    ACTIVE,
    ARCHIVED
  }

  public enum VariantStatus {
    ACTIVE,
    ARCHIVED
  }

  public enum Completeness {
    UNKNOWN,
    PARTIAL,
    COMPLETE
  }

  public enum Construction {
    WOVEN,
    KNIT,
    NONWOVEN,
    OTHER
  }

  public enum HideType {
    BOVINE,
    OVINE,
    CAPRINE,
    PORCINE,
    OTHER
  }

  public enum Tanning {
    CHROME,
    VEGETABLE,
    COMBINATION,
    OTHER
  }

  public enum Fact {
    RECORD,
    CATALOG_ARTICLE_NUMBER,
    NAME,
    DESCRIPTION,
    ORIGIN,
    COMPOSITION,
    FABRIC_SPEC,
    LEATHER_SPEC
  }

  public enum VariantFact {
    RECORD,
    CATALOG_VARIANT_SKU,
    NAME,
    COLOR,
    BATCH,
    ATTRIBUTES
  }

  public record Part(
      @NotNull UUID fiberTypeId,
      @NotNull
          @DecimalMin(value = "0", inclusive = false)
          @DecimalMax("100")
          @Digits(integer = 3, fraction = 4)
          BigDecimal percentage) {}

  public record PartView(UUID fiberTypeId, String fiberCode, BigDecimal percentage) {}

  public record Input(
      @NotNull UUID catalogSupplierId,
      @Size(max = 160) String catalogArticleNumber,
      @NotNull Type materialType,
      @NotBlank @Size(max = 160) String displayName,
      @Size(max = 4000) String description,
      UUID originCountryId,
      @NotNull Completeness compositionCompleteness,
      @NotNull List<@Valid Part> composition,
      @NotNull Status status,
      @NotNull UUID observationId,
      @Min(0) long version) {}

  public record View(
      UUID id,
      UUID catalogSupplierId,
      String catalogArticleNumber,
      Type materialType,
      String displayName,
      String description,
      UUID originCountryId,
      Completeness compositionCompleteness,
      List<PartView> composition,
      Status status,
      long version,
      Instant createdAt,
      Instant updatedAt) {}

  public record VariantInput(
      @NotNull UUID materialId,
      @Size(max = 160) String catalogVariantSku,
      @NotBlank @Size(max = 160) String variantName,
      @Size(max = 160) String colorName,
      @Size(max = 80) String colorCode,
      @Size(max = 100) String batchNumber,
      Map<String, Object> attributes,
      @NotNull VariantStatus status,
      @NotNull UUID observationId,
      @Min(0) long version) {}

  public record VariantView(
      UUID id,
      UUID materialId,
      String catalogVariantSku,
      String variantName,
      String colorName,
      String colorCode,
      String batchNumber,
      Map<String, Object> attributes,
      VariantStatus status,
      long version,
      Instant createdAt,
      Instant updatedAt) {}

  public record IdentityInput(@NotNull UUID sourceRecordId, @NotNull @Valid Input material) {}

  public record VariantIdentityInput(
      @NotNull UUID sourceRecordId, @NotNull @Valid VariantInput variant) {}

  public record CompositionInput(
      @NotNull Completeness completeness,
      @NotNull List<@Valid Part> parts,
      @NotNull UUID observationId,
      @Min(0) long version) {}

  public record Citation(@NotNull UUID observationId, @NotNull Fact fieldName) {}

  public record VariantCitation(@NotNull UUID observationId, @NotNull VariantFact fieldName) {}

  public record CitationView(UUID observationId, String fieldName, Instant createdAt) {}

  public record FiberInput(
      @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]*") @Size(max = 40) String code,
      @NotBlank @Size(max = 160) String nameEn,
      @Size(max = 160) String nameLocal,
      boolean active,
      @Min(0) long version) {}

  public record Fiber(
      UUID id, String code, String nameEn, String nameLocal, boolean active, long version) {}

  public record FabricInput(
      Construction construction,
      @Size(max = 80) String weaveType,
      @Size(max = 80) String knitType,
      @DecimalMin(value = "0", inclusive = false) @Digits(integer = 6, fraction = 4) BigDecimal gsm,
      @DecimalMin(value = "0", inclusive = false) @Digits(integer = 8, fraction = 4)
          BigDecimal widthMm,
      @DecimalMin(value = "0", inclusive = false) @Digits(integer = 6, fraction = 4)
          BigDecimal thicknessMm,
      @DecimalMin("0") @Digits(integer = 5, fraction = 4) BigDecimal stretchWarpPercentage,
      @DecimalMin("0") @Digits(integer = 5, fraction = 4) BigDecimal stretchWeftPercentage,
      @DecimalMin("-100") @DecimalMax("100") @Digits(integer = 3, fraction = 4)
          BigDecimal shrinkageWarpPercentage,
      @DecimalMin("-100") @DecimalMax("100") @Digits(integer = 3, fraction = 4)
          BigDecimal shrinkageWeftPercentage,
      @Size(max = 300) String finish,
      @Size(max = 300) String surface,
      @Size(max = 300) String handfeel,
      @Size(max = 300) String drape,
      @Size(max = 300) String luster,
      Map<String, Object> attributes,
      @NotNull UUID observationId,
      @Min(0) long version) {}

  public record FabricView(
      UUID materialId,
      String materialType,
      Construction construction,
      String weaveType,
      String knitType,
      BigDecimal gsm,
      BigDecimal widthMm,
      BigDecimal thicknessMm,
      BigDecimal stretchWarpPercentage,
      BigDecimal stretchWeftPercentage,
      BigDecimal shrinkageWarpPercentage,
      BigDecimal shrinkageWeftPercentage,
      String finish,
      String surface,
      String handfeel,
      String drape,
      String luster,
      Map<String, Object> attributes,
      long version,
      Instant createdAt,
      Instant updatedAt) {}

  public record LeatherInput(
      HideType hideType,
      Tanning tanningMethod,
      @DecimalMin(value = "0", inclusive = false) @Digits(integer = 6, fraction = 4)
          BigDecimal thicknessMinMm,
      @DecimalMin(value = "0", inclusive = false) @Digits(integer = 6, fraction = 4)
          BigDecimal thicknessMaxMm,
      @DecimalMin(value = "0", inclusive = false) @Digits(integer = 8, fraction = 4)
          BigDecimal averageHideAreaM2,
      @Size(max = 300) String finish,
      @Size(max = 300) String surface,
      @Size(max = 300) String handfeel,
      @Size(max = 300) String luster,
      Map<String, Object> attributes,
      @NotNull UUID observationId,
      @Min(0) long version) {}

  public record LeatherView(
      UUID materialId,
      String materialType,
      HideType hideType,
      Tanning tanningMethod,
      BigDecimal thicknessMinMm,
      BigDecimal thicknessMaxMm,
      BigDecimal averageHideAreaM2,
      String finish,
      String surface,
      String handfeel,
      String luster,
      Map<String, Object> attributes,
      long version,
      Instant createdAt,
      Instant updatedAt) {}

  private final MaterialRepository materials;
  private final VariantRepository variants;
  private final JdbcClient jdbc;
  private final PlatformAuthorization auth;
  private final AuditRecorder audit;
  private final SourceService sources;
  private final SupplierService suppliers;

  public MaterialService(
      MaterialRepository materials,
      VariantRepository variants,
      JdbcClient jdbc,
      PlatformAuthorization auth,
      AuditRecorder audit,
      SourceService sources,
      SupplierService suppliers) {
    this.materials = materials;
    this.variants = variants;
    this.jdbc = jdbc;
    this.auth = auth;
    this.audit = audit;
    this.sources = sources;
    this.suppliers = suppliers;
  }

  private MaterialEntity find(UUID id) {
    return materials.findById(id).orElseThrow(ValidationRules::missing);
  }

  private VariantEntity findVariant(UUID id) {
    return variants.findById(id).orElseThrow(ValidationRules::missing);
  }

  public View read(UUID id) {
    return view(find(id));
  }

  private View view(MaterialEntity e) {
    return new View(
        e.id,
        e.catalogSupplierId,
        e.catalogArticleNumber,
        Type.valueOf(e.materialType),
        e.displayName,
        e.description,
        e.originCountryId,
        Completeness.valueOf(e.compositionCompleteness),
        parts(e.id),
        Status.valueOf(e.status),
        e.version,
        e.createdAt,
        e.updatedAt);
  }

  public VariantView variant(UUID id) {
    var e = findVariant(id);
    String json =
        jdbc.sql("SELECT attributes::text FROM material_variant WHERE id=:id")
            .param("id", id)
            .query(String.class)
            .optional()
            .orElse(null);
    return new VariantView(
        e.id,
        e.materialId,
        e.catalogVariantSku,
        e.variantName,
        e.colorName,
        e.colorCode,
        e.batchNumber,
        PhysicalAttributes.read(json),
        VariantStatus.valueOf(e.status),
        e.version,
        e.createdAt,
        e.updatedAt);
  }

  public void requireVariant(UUID id, UUID material) {
    if (id != null && !variant(id).materialId().equals(material))
      throw ValidationRules.bad("Variant belongs to another material");
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void lock(UUID id) {
    if (jdbc.sql("SELECT id FROM material WHERE id=:id FOR UPDATE")
        .param("id", id)
        .query(UUID.class)
        .optional()
        .isEmpty()) throw ValidationRules.missing();
  }

  public List<PartView> parts(UUID id) {
    return jdbc.sql(
            "SELECT c.fiber_type_id,f.code,c.percentage FROM material_composition c JOIN fiber_type"
                + " f ON f.id=c.fiber_type_id WHERE material_id=:id ORDER BY f.code")
        .param("id", id)
        .query(
            (r, n) -> new PartView(r.getObject(1, UUID.class), r.getString(2), r.getBigDecimal(3)))
        .list();
  }

  private void validateParts(Completeness completeness, List<Part> parts) {
    if (completeness == null || parts == null)
      throw ValidationRules.bad("Composition completeness and parts required");
    BigDecimal total = BigDecimal.ZERO;
    Set<UUID> seen = new HashSet<>();
    for (var p : parts) {
      if (p == null || p.fiberTypeId() == null || p.percentage() == null)
        throw ValidationRules.bad("Invalid component");
      DecimalValues.quantity(p.percentage(), false);
      if (p.percentage().compareTo(new BigDecimal("100")) > 0 || !seen.add(p.fiberTypeId()))
        throw ValidationRules.bad("Invalid component or duplicate fiber");
      total = total.add(p.percentage());
    }
    if ((completeness == Completeness.UNKNOWN && !parts.isEmpty())
        || (completeness != Completeness.UNKNOWN && parts.isEmpty())
        || total.compareTo(new BigDecimal("100")) > 0
        || (completeness == Completeness.COMPLETE && total.compareTo(new BigDecimal("100")) != 0))
      throw ValidationRules.bad("Composition does not match completeness");
  }

  private void replaceParts(UUID id, List<Part> input) {
    var before = parts(id);
    jdbc.sql("DELETE FROM material_composition WHERE material_id=:id").param("id", id).update();
    for (var p : input) {
      jdbc.sql(
              "INSERT INTO material_composition(material_id,fiber_type_id,percentage)"
                  + " VALUES(:id,:fiber,:percentage)")
          .param("id", id)
          .param("fiber", p.fiberTypeId())
          .param("percentage", p.percentage())
          .update();
    }
    Map<UUID, BigDecimal> old = new HashMap<>(), next = new HashMap<>();
    before.forEach(p -> old.put(p.fiberTypeId(), p.percentage()));
    input.forEach(p -> next.put(p.fiberTypeId(), p.percentage()));
    Set<UUID> keys = new HashSet<>(old.keySet());
    keys.addAll(next.keySet());
    for (var key : keys) {
      if (Objects.equals(old.get(key), next.get(key))) continue;
      Map<String, Object> b = new HashMap<>(), a = new HashMap<>();
      b.put("fiberTypeId", key);
      b.put("percentage", old.get(key));
      a.put("fiberTypeId", key);
      a.put("percentage", next.get(key));
      audit.changed("material.composition.component.changed", "Material", id, b, a);
    }
  }

  private void apply(MaterialEntity e, Input v) {
    e.catalogArticleNumber = v.catalogArticleNumber();
    e.displayName = v.displayName().strip();
    e.normalizedName = SearchText.normalize(v.displayName());
    if (e.normalizedName.length() > 320)
      throw ValidationRules.bad("Normalized material name too long");
    e.description = v.description();
    e.originCountryId = v.originCountryId();
    e.compositionCompleteness = v.compositionCompleteness().name();
    e.status = v.status().name();
    e.updatedAt = Instant.now();
  }

  @Transactional
  public View create(Input v) {
    auth.requireAdmin();
    validateParts(v.compositionCompleteness(), v.composition());
    suppliers.read(v.catalogSupplierId());
    sources.requireObservation(v.observationId());
    var e = new MaterialEntity();
    e.id = UUID.randomUUID();
    e.catalogSupplierId = v.catalogSupplierId();
    e.materialType = v.materialType().name();
    e.createdAt = Instant.now();
    apply(e, v);
    e = materials.saveAndFlush(e);
    replaceParts(e.id, v.composition());
    cite(e.id, new Citation(v.observationId(), Fact.RECORD));
    audit.changed(
        "material.created",
        "Material",
        e.id,
        null,
        Map.of(
            "catalogSupplierId",
            e.catalogSupplierId,
            "materialType",
            e.materialType,
            "status",
            e.status));
    return view(e);
  }

  @Transactional
  public View update(UUID id, Input v) {
    auth.requireAdmin();
    validateParts(v.compositionCompleteness(), v.composition());
    sources.requireObservation(v.observationId());
    lock(id);
    var e = find(id);
    if (e.version != v.version()) throw ValidationRules.conflict();
    if (!e.catalogSupplierId.equals(v.catalogSupplierId())
        || !e.materialType.equals(v.materialType().name()))
      throw ValidationRules.bad("Material identity cannot be reassigned");
    String before = e.status;
    apply(e, v);
    materials.flush();
    replaceParts(id, v.composition());
    cite(id, new Citation(v.observationId(), Fact.RECORD));
    audit.changed(
        "material.updated",
        "Material",
        id,
        Map.of("status", before),
        Map.of(
            "status",
            e.status,
            "version",
            e.version,
            "compositionCompleteness",
            e.compositionCompleteness));
    return view(e);
  }

  @Transactional
  public View composition(UUID id, CompositionInput v) {
    auth.requireAdmin();
    validateParts(v.completeness(), v.parts());
    sources.requireObservation(v.observationId());
    lock(id);
    var e = find(id);
    if (e.version != v.version()) throw ValidationRules.conflict();
    String before = e.compositionCompleteness;
    e.compositionCompleteness = v.completeness().name();
    e.updatedAt = Instant.now();
    materials.flush();
    replaceParts(id, v.parts());
    cite(id, new Citation(v.observationId(), Fact.COMPOSITION));
    audit.changed(
        "material.composition.changed",
        "Material",
        id,
        Map.of("compositionCompleteness", before),
        Map.of("compositionCompleteness", e.compositionCompleteness));
    return view(e);
  }

  private void applyVariant(VariantEntity e, VariantInput v) {
    e.catalogVariantSku = v.catalogVariantSku();
    e.variantName = v.variantName().strip();
    e.colorName = v.colorName();
    e.colorCode = v.colorCode();
    e.batchNumber = v.batchNumber();
    e.status = v.status().name();
    e.updatedAt = Instant.now();
  }

  private void variantAttributes(UUID id, Map<String, Object> values) {
    jdbc.sql("UPDATE material_variant SET attributes=CAST(:json AS jsonb) WHERE id=:id")
        .param("json", PhysicalAttributes.json(values))
        .param("id", id)
        .update();
  }

  @Transactional
  public VariantView createVariant(VariantInput v) {
    auth.requireAdmin();
    read(v.materialId());
    sources.requireObservation(v.observationId());
    PhysicalAttributes.json(v.attributes());
    var e = new VariantEntity();
    e.id = UUID.randomUUID();
    e.materialId = v.materialId();
    e.createdAt = Instant.now();
    applyVariant(e, v);
    e = variants.saveAndFlush(e);
    variantAttributes(e.id, v.attributes());
    citeVariant(e.id, new VariantCitation(v.observationId(), VariantFact.RECORD));
    audit.changed(
        "material.variant.created",
        "MaterialVariant",
        e.id,
        null,
        Map.of("materialId", e.materialId));
    return variant(e.id);
  }

  @Transactional
  public VariantView updateVariant(UUID id, VariantInput v) {
    auth.requireAdmin();
    sources.requireObservation(v.observationId());
    PhysicalAttributes.json(v.attributes());
    var e = findVariant(id);
    if (e.version != v.version()) throw ValidationRules.conflict();
    if (!e.materialId.equals(v.materialId()))
      throw ValidationRules.bad("Variant parent is immutable");
    applyVariant(e, v);
    variants.flush();
    variantAttributes(id, v.attributes());
    citeVariant(id, new VariantCitation(v.observationId(), VariantFact.RECORD));
    audit.changed(
        "material.variant.updated",
        "MaterialVariant",
        id,
        null,
        Map.of("version", e.version, "status", e.status));
    return variant(id);
  }

  public List<VariantView> variants(UUID material, int limit, int offset) {
    read(material);
    ValidationRules.page(limit, offset);
    return jdbc
        .sql(
            "SELECT id FROM material_variant WHERE material_id=:id ORDER BY created_at DESC,id DESC"
                + " LIMIT :limit OFFSET :offset")
        .param("id", material)
        .param("limit", limit)
        .param("offset", offset)
        .query(UUID.class)
        .list()
        .stream()
        .map(this::variant)
        .toList();
  }

  @Transactional
  public void cite(UUID id, Citation v) {
    auth.requireAdmin();
    read(id);
    insertCitation(
        "material_source", "material_id", id, v.observationId(), v.fieldName().name(), "Material");
  }

  @Transactional
  public void citeVariant(UUID id, VariantCitation v) {
    auth.requireAdmin();
    variant(id);
    insertCitation(
        "material_variant_source",
        "material_variant_id",
        id,
        v.observationId(),
        v.fieldName().name(),
        "MaterialVariant");
  }

  private void insertCitation(
      String table, String key, UUID id, UUID observation, String fact, String type) {
    int n =
        jdbc.sql(
                "INSERT INTO "
                    + table
                    + "("
                    + key
                    + ",source_observation_id,field_name) VALUES(:id,:obs,:fact) ON CONFLICT DO"
                    + " NOTHING")
            .param("id", id)
            .param("obs", observation)
            .param("fact", fact)
            .update();
    if (n > 0)
      audit.changed("material.source.added", type, id, null, Map.of("observationId", observation));
  }

  public List<CitationView> citations(UUID id, boolean variant, int limit, int offset) {
    auth.requireAdmin();
    ValidationRules.page(limit, offset);
    if (variant) variant(id);
    else read(id);
    return jdbc.sql(
            "SELECT source_observation_id,field_name,created_at FROM "
                + (variant ? "material_variant_source" : "material_source")
                + " WHERE "
                + (variant ? "material_variant_id" : "material_id")
                + "=:id ORDER BY created_at DESC,source_observation_id,field_name LIMIT :limit"
                + " OFFSET :offset")
        .param("id", id)
        .param("limit", limit)
        .param("offset", offset)
        .query(
            (r, n) ->
                new CitationView(
                    r.getObject(1, UUID.class),
                    r.getString(2),
                    r.getObject(3, OffsetDateTime.class).toInstant()))
        .list();
  }

  private UUID bound(String table, String column, UUID record) {
    return jdbc.sql("SELECT " + column + " FROM " + table + " WHERE source_record_id=:record")
        .param("record", record)
        .query(UUID.class)
        .optional()
        .orElse(null);
  }

  @Transactional
  public void bind(UUID id, UUID record, boolean variant) {
    auth.requireAdmin();
    if (variant) variant(id);
    else read(id);
    sources.lockRecord(
        record,
        variant ? SourceService.RecordKind.MATERIAL_VARIANT : SourceService.RecordKind.MATERIAL);
    String table = variant ? "material_variant_external_record" : "material_external_record",
        column = variant ? "material_variant_id" : "material_id";
    UUID prior = bound(table, column, record);
    if (prior != null) {
      if (!prior.equals(id)) throw ValidationRules.conflict();
      return;
    }
    jdbc.sql("INSERT INTO " + table + "(source_record_id," + column + ") VALUES(:record,:id)")
        .param("record", record)
        .param("id", id)
        .update();
    audit.changed(
        "material.identity.bound", variant ? "MaterialVariant" : "Material", id, null, null);
  }

  @Transactional
  public View resolve(IdentityInput v) {
    auth.requireAdmin();
    sources.lockRecord(v.sourceRecordId(), SourceService.RecordKind.MATERIAL);
    sources.requireObservationForRecord(v.material().observationId(), v.sourceRecordId());
    UUID prior = bound("material_external_record", "material_id", v.sourceRecordId());
    if (prior != null) {
      cite(prior, new Citation(v.material().observationId(), Fact.RECORD));
      return read(prior);
    }
    var result = create(v.material());
    bind(result.id(), v.sourceRecordId(), false);
    return result;
  }

  @Transactional
  public VariantView resolveVariant(VariantIdentityInput v) {
    auth.requireAdmin();
    sources.lockRecord(v.sourceRecordId(), SourceService.RecordKind.MATERIAL_VARIANT);
    sources.requireObservationForRecord(v.variant().observationId(), v.sourceRecordId());
    UUID prior =
        bound("material_variant_external_record", "material_variant_id", v.sourceRecordId());
    if (prior != null) {
      citeVariant(prior, new VariantCitation(v.variant().observationId(), VariantFact.RECORD));
      return variant(prior);
    }
    var result = createVariant(v.variant());
    bind(result.id(), v.sourceRecordId(), true);
    return result;
  }

  public List<Fiber> fibers(int limit, int offset) {
    ValidationRules.page(limit, offset);
    return jdbc.sql("SELECT * FROM fiber_type ORDER BY code LIMIT :limit OFFSET :offset")
        .param("limit", limit)
        .param("offset", offset)
        .query(
            (r, n) ->
                new Fiber(
                    r.getObject("id", UUID.class),
                    r.getString("code"),
                    r.getString("name_en"),
                    r.getString("name_local"),
                    r.getBoolean("active"),
                    r.getLong("version")))
        .list();
  }

  @Transactional
  public UUID fiber(UUID id, FiberInput v) {
    auth.requireAdmin();
    UUID key = id == null ? UUID.randomUUID() : id;
    int n;
    if (id == null) {
      n =
          jdbc.sql(
                  "INSERT INTO fiber_type(id,code,name_en,name_local,active)"
                      + " VALUES(:id,:code,:name,:local,:active)")
              .param("id", key)
              .param("code", v.code())
              .param("name", v.nameEn())
              .param("local", v.nameLocal())
              .param("active", v.active())
              .update();
    } else {
      String code =
          jdbc.sql("SELECT code FROM fiber_type WHERE id=:id")
              .param("id", id)
              .query(String.class)
              .optional()
              .orElseThrow(ValidationRules::missing);
      if (!code.equals(v.code())) throw ValidationRules.bad("Fiber code is immutable");
      n =
          jdbc.sql(
                  "UPDATE fiber_type SET"
                      + " name_en=:name,name_local=:local,active=:active,version=version+1,updated_at=now()"
                      + " WHERE id=:id AND version=:version")
              .param("id", id)
              .param("version", v.version())
              .param("name", v.nameEn())
              .param("local", v.nameLocal())
              .param("active", v.active())
              .update();
    }
    if (n != 1) throw ValidationRules.conflict();
    audit.changed("material.fiber.saved", "FiberType", key, null, null);
    return key;
  }

  public FabricView fabric(UUID id) {
    read(id);
    return jdbc.sql("SELECT * FROM fabric_spec WHERE material_id=:id")
        .param("id", id)
        .query(
            (r, n) ->
                new FabricView(
                    id,
                    r.getString("material_type"),
                    (r.getString("construction") == null
                        ? null
                        : Construction.valueOf(r.getString("construction"))),
                    r.getString("weave_type"),
                    r.getString("knit_type"),
                    r.getBigDecimal("gsm"),
                    r.getBigDecimal("width_mm"),
                    r.getBigDecimal("thickness_mm"),
                    r.getBigDecimal("stretch_warp_percentage"),
                    r.getBigDecimal("stretch_weft_percentage"),
                    r.getBigDecimal("shrinkage_warp_percentage"),
                    r.getBigDecimal("shrinkage_weft_percentage"),
                    r.getString("finish"),
                    r.getString("surface"),
                    r.getString("handfeel"),
                    r.getString("drape"),
                    r.getString("luster"),
                    PhysicalAttributes.read(r.getString("attributes")),
                    r.getLong("version"),
                    r.getObject("created_at", OffsetDateTime.class).toInstant(),
                    r.getObject("updated_at", OffsetDateTime.class).toInstant()))
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  @Transactional
  public FabricView fabric(UUID id, FabricInput v) {
    auth.requireAdmin();
    lock(id);
    sources.requireObservation(v.observationId());
    PhysicalAttributes.json(v.attributes());
    boolean exists =
        jdbc.sql("SELECT EXISTS(SELECT 1 FROM fabric_spec WHERE material_id=:id)")
            .param("id", id)
            .query(Boolean.class)
            .single();
    if (!exists && v.version() != 0) throw ValidationRules.conflict();
    int n =
        jdbc.sql(
                "INSERT INTO"
                    + " fabric_spec(material_id,construction,weave_type,knit_type,gsm,width_mm,thickness_mm,stretch_warp_percentage,stretch_weft_percentage,shrinkage_warp_percentage,shrinkage_weft_percentage,finish,surface,handfeel,drape,luster,attributes)"
                    + " VALUES(:id,:construction,:weaveType,:knitType,:gsm,:widthMm,:thicknessMm,:stretchWarpPercentage,:stretchWeftPercentage,:shrinkageWarpPercentage,:shrinkageWeftPercentage,:finish,:surface,:handfeel,:drape,:luster,CAST(:attributes"
                    + " AS jsonb)) ON CONFLICT(material_id) DO UPDATE SET"
                    + " construction=EXCLUDED.construction,weave_type=EXCLUDED.weave_type,knit_type=EXCLUDED.knit_type,gsm=EXCLUDED.gsm,width_mm=EXCLUDED.width_mm,thickness_mm=EXCLUDED.thickness_mm,stretch_warp_percentage=EXCLUDED.stretch_warp_percentage,stretch_weft_percentage=EXCLUDED.stretch_weft_percentage,shrinkage_warp_percentage=EXCLUDED.shrinkage_warp_percentage,shrinkage_weft_percentage=EXCLUDED.shrinkage_weft_percentage,finish=EXCLUDED.finish,surface=EXCLUDED.surface,handfeel=EXCLUDED.handfeel,drape=EXCLUDED.drape,luster=EXCLUDED.luster,attributes=EXCLUDED.attributes,version=fabric_spec.version+1,updated_at=now()"
                    + " WHERE fabric_spec.version=:version")
            .param("id", id)
            .param("version", v.version())
            .param("construction", (v.construction() == null ? null : v.construction().name()))
            .param("weaveType", v.weaveType())
            .param("knitType", v.knitType())
            .param("gsm", v.gsm())
            .param("widthMm", v.widthMm())
            .param("thicknessMm", v.thicknessMm())
            .param("stretchWarpPercentage", v.stretchWarpPercentage())
            .param("stretchWeftPercentage", v.stretchWeftPercentage())
            .param("shrinkageWarpPercentage", v.shrinkageWarpPercentage())
            .param("shrinkageWeftPercentage", v.shrinkageWeftPercentage())
            .param("finish", v.finish())
            .param("surface", v.surface())
            .param("handfeel", v.handfeel())
            .param("drape", v.drape())
            .param("luster", v.luster())
            .param("attributes", PhysicalAttributes.json(v.attributes()))
            .update();
    if (n != 1) throw ValidationRules.conflict();
    cite(id, new Citation(v.observationId(), Fact.FABRIC_SPEC));
    audit.changed("material.fabric.saved", "Material", id, null, null);
    return fabric(id);
  }

  public LeatherView leather(UUID id) {
    read(id);
    return jdbc.sql("SELECT * FROM leather_spec WHERE material_id=:id")
        .param("id", id)
        .query(
            (r, n) ->
                new LeatherView(
                    id,
                    r.getString("material_type"),
                    (r.getString("hide_type") == null
                        ? null
                        : HideType.valueOf(r.getString("hide_type"))),
                    (r.getString("tanning_method") == null
                        ? null
                        : Tanning.valueOf(r.getString("tanning_method"))),
                    r.getBigDecimal("thickness_min_mm"),
                    r.getBigDecimal("thickness_max_mm"),
                    r.getBigDecimal("average_hide_area_m2"),
                    r.getString("finish"),
                    r.getString("surface"),
                    r.getString("handfeel"),
                    r.getString("luster"),
                    PhysicalAttributes.read(r.getString("attributes")),
                    r.getLong("version"),
                    r.getObject("created_at", OffsetDateTime.class).toInstant(),
                    r.getObject("updated_at", OffsetDateTime.class).toInstant()))
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  @Transactional
  public LeatherView leather(UUID id, LeatherInput v) {
    auth.requireAdmin();
    lock(id);
    sources.requireObservation(v.observationId());
    PhysicalAttributes.json(v.attributes());
    boolean exists =
        jdbc.sql("SELECT EXISTS(SELECT 1 FROM leather_spec WHERE material_id=:id)")
            .param("id", id)
            .query(Boolean.class)
            .single();
    if (!exists && v.version() != 0) throw ValidationRules.conflict();
    int n =
        jdbc.sql(
                "INSERT INTO"
                    + " leather_spec(material_id,hide_type,tanning_method,thickness_min_mm,thickness_max_mm,average_hide_area_m2,finish,surface,handfeel,luster,attributes)"
                    + " VALUES(:id,:hideType,:tanningMethod,:thicknessMinMm,:thicknessMaxMm,:averageHideAreaM2,:finish,:surface,:handfeel,:luster,CAST(:attributes"
                    + " AS jsonb)) ON CONFLICT(material_id) DO UPDATE SET"
                    + " hide_type=EXCLUDED.hide_type,tanning_method=EXCLUDED.tanning_method,thickness_min_mm=EXCLUDED.thickness_min_mm,thickness_max_mm=EXCLUDED.thickness_max_mm,average_hide_area_m2=EXCLUDED.average_hide_area_m2,finish=EXCLUDED.finish,surface=EXCLUDED.surface,handfeel=EXCLUDED.handfeel,luster=EXCLUDED.luster,attributes=EXCLUDED.attributes,version=leather_spec.version+1,updated_at=now()"
                    + " WHERE leather_spec.version=:version")
            .param("id", id)
            .param("version", v.version())
            .param("hideType", (v.hideType() == null ? null : v.hideType().name()))
            .param("tanningMethod", (v.tanningMethod() == null ? null : v.tanningMethod().name()))
            .param("thicknessMinMm", v.thicknessMinMm())
            .param("thicknessMaxMm", v.thicknessMaxMm())
            .param("averageHideAreaM2", v.averageHideAreaM2())
            .param("finish", v.finish())
            .param("surface", v.surface())
            .param("handfeel", v.handfeel())
            .param("luster", v.luster())
            .param("attributes", PhysicalAttributes.json(v.attributes()))
            .update();
    if (n != 1) throw ValidationRules.conflict();
    cite(id, new Citation(v.observationId(), Fact.LEATHER_SPEC));
    audit.changed("material.leather.saved", "Material", id, null, null);
    return leather(id);
  }
}
