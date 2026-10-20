package com.sourceos.materiallisting;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.authorization.PlatformAuthorization;
import com.sourceos.dataingestion.SourceService;
import com.sourceos.material.MaterialService;
import com.sourceos.shared.*;
import com.sourceos.supplier.SupplierService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ListingService {
  public enum Status {
    ACTIVE,
    ARCHIVED
  }

  public enum Fact {
    RECORD,
    SELLER_ARTICLE_NUMBER,
    MOQ,
    MCQ,
    UNIT,
    STANDARD_LEAD_TIME,
    REPRODUCTION_LEAD_TIME
  }

  @io.swagger.v3.oas.annotations.media.Schema(name = "ListingInput")
  public record Input(
      @NotNull UUID materialId,
      @NotNull UUID sellerSupplierId,
      @Size(max = 160) String sellerArticleNumber,
      @DecimalMin("0") @Digits(integer = 15, fraction = 4) BigDecimal minimumOrderQuantity,
      @DecimalMin("0") @Digits(integer = 15, fraction = 4) BigDecimal minimumColorQuantity,
      MeasurementUnit quantityUnit,
      @Min(0) Integer standardLeadTimeDays,
      @Min(0) Integer reproductionLeadTimeDays,
      @NotNull Status status,
      @NotNull UUID observationId,
      @Min(0) long version) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "ListingView")
  public record View(
      UUID id,
      UUID materialId,
      UUID sellerSupplierId,
      String sellerArticleNumber,
      BigDecimal minimumOrderQuantity,
      BigDecimal minimumColorQuantity,
      MeasurementUnit quantityUnit,
      Integer standardLeadTimeDays,
      Integer reproductionLeadTimeDays,
      Status status,
      long version,
      Instant createdAt,
      Instant updatedAt) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "ListingIdentityInput")
  public record IdentityInput(@NotNull UUID sourceRecordId, @NotNull @Valid Input listing) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "ListingCitation")
  public record Citation(@NotNull UUID observationId, @NotNull Fact fieldName) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "ListingCitationView")
  public record CitationView(UUID observationId, String fieldName, Instant createdAt) {}

  private final ListingRepository repository;
  private final JdbcClient jdbc;
  private final MaterialService materials;
  private final SupplierService suppliers;
  private final SourceService sources;
  private final PlatformAuthorization auth;
  private final AuditRecorder audit;

  public ListingService(
      ListingRepository repository,
      JdbcClient jdbc,
      MaterialService materials,
      SupplierService suppliers,
      SourceService sources,
      PlatformAuthorization auth,
      AuditRecorder audit) {
    this.repository = repository;
    this.jdbc = jdbc;
    this.materials = materials;
    this.suppliers = suppliers;
    this.sources = sources;
    this.auth = auth;
    this.audit = audit;
  }

  private ListingEntity find(UUID id) {
    return repository.findById(id).orElseThrow(ValidationRules::missing);
  }

  public View read(UUID id) {
    return view(find(id));
  }

  private View view(ListingEntity e) {
    return new View(
        e.id,
        e.materialId,
        e.sellerSupplierId,
        e.sellerArticleNumber,
        e.minimumOrderQuantity,
        e.minimumColorQuantity,
        e.quantityUnit == null ? null : MeasurementUnit.valueOf(e.quantityUnit),
        e.standardLeadTimeDays,
        e.reproductionLeadTimeDays,
        Status.valueOf(e.status),
        e.version,
        e.createdAt,
        e.updatedAt);
  }

  private void validate(Input v) {
    DecimalValues.quantity(v.minimumOrderQuantity(), true);
    DecimalValues.quantity(v.minimumColorQuantity(), true);
    if ((v.minimumOrderQuantity() != null || v.minimumColorQuantity() != null)
        && v.quantityUnit() == null)
      throw ValidationRules.bad("Listing minimum quantities require a unit");
    if ((v.standardLeadTimeDays() != null && v.standardLeadTimeDays() < 0)
        || (v.reproductionLeadTimeDays() != null && v.reproductionLeadTimeDays() < 0))
      throw ValidationRules.bad("Negative lead time");
  }

  private void apply(ListingEntity e, Input v) {
    e.sellerArticleNumber = v.sellerArticleNumber();
    e.minimumOrderQuantity = v.minimumOrderQuantity();
    e.minimumColorQuantity = v.minimumColorQuantity();
    e.quantityUnit = v.quantityUnit() == null ? null : v.quantityUnit().name();
    e.standardLeadTimeDays = v.standardLeadTimeDays();
    e.reproductionLeadTimeDays = v.reproductionLeadTimeDays();
    e.status = v.status().name();
    e.updatedAt = Instant.now();
  }

  private Map<String, Object> state(ListingEntity e) {
    Map<String, Object> s = new HashMap<>();
    s.put("minimumOrderQuantity", e.minimumOrderQuantity);
    s.put("minimumColorQuantity", e.minimumColorQuantity);
    s.put("quantityUnit", e.quantityUnit);
    s.put("standardLeadTimeDays", e.standardLeadTimeDays);
    s.put("reproductionLeadTimeDays", e.reproductionLeadTimeDays);
    s.put("status", e.status);
    s.put("version", e.version);
    return s;
  }

  @Transactional
  public View create(Input v) {
    auth.requireAdmin();
    validate(v);
    materials.read(v.materialId());
    suppliers.read(v.sellerSupplierId());
    sources.requireObservation(v.observationId());
    var e = new ListingEntity();
    e.id = UUID.randomUUID();
    e.materialId = v.materialId();
    e.sellerSupplierId = v.sellerSupplierId();
    e.createdAt = Instant.now();
    apply(e, v);
    e = repository.saveAndFlush(e);
    cite(e.id, new Citation(v.observationId(), Fact.RECORD));
    audit.changed(
        "material.listing.created",
        "SupplierMaterialListing",
        e.id,
        null,
        Map.of("materialId", e.materialId, "sellerSupplierId", e.sellerSupplierId));
    return view(e);
  }

  @Transactional
  public View update(UUID id, Input v) {
    auth.requireAdmin();
    validate(v);
    sources.requireObservation(v.observationId());
    var e = find(id);
    if (e.version != v.version()) throw ValidationRules.conflict();
    if (!e.materialId.equals(v.materialId()) || !e.sellerSupplierId.equals(v.sellerSupplierId()))
      throw ValidationRules.bad("Listing identity cannot be reassigned");
    var before = state(e);
    apply(e, v);
    repository.flush();
    cite(id, new Citation(v.observationId(), Fact.RECORD));
    audit.changed("material.listing.updated", "SupplierMaterialListing", id, before, state(e));
    return view(e);
  }

  public List<View> list(UUID material, UUID seller, int limit, int offset) {
    ValidationRules.page(limit, offset);
    if (material != null) materials.read(material);
    if (seller != null) suppliers.read(seller);
    return jdbc
        .sql(
            "SELECT id FROM supplier_material_listing WHERE (CAST(:material AS uuid) IS NULL OR"
                + " material_id=:material) AND (CAST(:seller AS uuid) IS NULL OR"
                + " seller_supplier_id=:seller) ORDER BY created_at DESC,id DESC LIMIT :limit"
                + " OFFSET :offset")
        .param("material", material, java.sql.Types.OTHER)
        .param("seller", seller, java.sql.Types.OTHER)
        .param("limit", limit)
        .param("offset", offset)
        .query(UUID.class)
        .list()
        .stream()
        .map(this::read)
        .toList();
  }

  @Transactional
  public void cite(UUID id, Citation v) {
    auth.requireAdmin();
    read(id);
    int n =
        jdbc.sql(
                "INSERT INTO"
                    + " supplier_material_listing_source(listing_id,source_observation_id,field_name)"
                    + " VALUES(:id,:obs,:fact) ON CONFLICT DO NOTHING")
            .param("id", id)
            .param("obs", v.observationId())
            .param("fact", v.fieldName().name())
            .update();
    if (n > 0)
      audit.changed(
          "material.listing.source.added",
          "SupplierMaterialListing",
          id,
          null,
          Map.of("observationId", v.observationId()));
  }

  public List<CitationView> citations(UUID id, int limit, int offset) {
    auth.requireAdmin();
    read(id);
    ValidationRules.page(limit, offset);
    return jdbc.sql(
            "SELECT source_observation_id,field_name,created_at FROM"
                + " supplier_material_listing_source WHERE listing_id=:id ORDER BY created_at"
                + " DESC,source_observation_id,field_name LIMIT :limit OFFSET :offset")
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

  @Transactional
  public void bind(UUID id, UUID record) {
    auth.requireAdmin();
    read(id);
    sources.lockRecord(record, SourceService.RecordKind.MATERIAL_LISTING);
    UUID prior = bound(record);
    if (prior != null) {
      if (!prior.equals(id)) throw ValidationRules.conflict();
      return;
    }
    jdbc.sql(
            "INSERT INTO supplier_material_listing_external_record(source_record_id,listing_id)"
                + " VALUES(:record,:id)")
        .param("record", record)
        .param("id", id)
        .update();
    audit.changed("material.listing.identity.bound", "SupplierMaterialListing", id, null, null);
  }

  private UUID bound(UUID record) {
    return jdbc.sql(
            "SELECT listing_id FROM supplier_material_listing_external_record WHERE"
                + " source_record_id=:record")
        .param("record", record)
        .query(UUID.class)
        .optional()
        .orElse(null);
  }

  @Transactional
  public View resolve(IdentityInput v) {
    auth.requireAdmin();
    sources.lockRecord(v.sourceRecordId(), SourceService.RecordKind.MATERIAL_LISTING);
    sources.requireObservationForRecord(v.listing().observationId(), v.sourceRecordId());
    UUID prior = bound(v.sourceRecordId());
    if (prior != null) {
      cite(prior, new Citation(v.listing().observationId(), Fact.RECORD));
      return read(prior);
    }
    var result = create(v.listing());
    bind(result.id(), v.sourceRecordId());
    return result;
  }
}
