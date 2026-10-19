package com.sourceos.facility;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.authorization.PlatformAuthorization;
import com.sourceos.dataingestion.SourceService;
import com.sourceos.shared.ValidationRules;
import com.sourceos.supplier.SupplierService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FacilityService {
  public enum Type {
    OFFICE,
    MILL,
    FACTORY,
    WAREHOUSE,
    SHOWROOM,
    PROCESSING_PLANT,
    QC_SITE,
    OTHER
  }

  public enum Status {
    ACTIVE,
    ARCHIVED
  }

  public enum Proficiency {
    SUPPORTED,
    EXPERIENCED,
    SPECIALIST
  }

  public enum Unit {
    PCS,
    METER,
    YARD,
    KG,
    GRAM,
    MM,
    CM,
    M2
  }

  public enum Verification {
    UNVERIFIED,
    DOCUMENTED,
    AUDITED
  }

  public enum Fact {
    RECORD,
    NAME,
    TYPE,
    COUNTRY,
    REGION,
    CLUSTER,
    ADDRESS,
    COORDINATES,
    PHONE,
    EMAIL
  }

  public record Input(
      @NotNull UUID supplierId,
      @NotNull Type facilityType,
      @NotBlank @Size(max = 160) String name,
      @NotNull UUID countryId,
      UUID regionId,
      UUID industrialClusterId,
      @Size(max = 300) String addressLine1,
      @Size(max = 300) String addressLine2,
      @Size(max = 30) String postalCode,
      @DecimalMin("-90") @DecimalMax("90") @Digits(integer = 3, fraction = 6) BigDecimal latitude,
      @DecimalMin("-180") @DecimalMax("180") @Digits(integer = 3, fraction = 6)
          BigDecimal longitude,
      @Size(max = 80) String phone,
      @Email @Size(max = 254) String email,
      @NotNull Status status,
      @NotNull UUID observationId,
      @Min(0) long version) {}

  public record View(
      UUID id,
      UUID supplierId,
      Type facilityType,
      String name,
      UUID countryId,
      UUID regionId,
      UUID industrialClusterId,
      String addressLine1,
      String addressLine2,
      String postalCode,
      BigDecimal latitude,
      BigDecimal longitude,
      String phone,
      String email,
      Status status,
      long version,
      Instant createdAt,
      Instant updatedAt) {}

  public record IdentityInput(@NotNull UUID sourceRecordId, @NotNull @Valid Input facility) {}

  public record Citation(@NotNull UUID observationId, @NotNull Fact fieldName) {}

  public record CapabilityInput(
      Proficiency proficiencyLevel,
      @DecimalMin("0") @Digits(integer = 15, fraction = 4) BigDecimal minimumOrderQuantity,
      @DecimalMin("0") @Digits(integer = 15, fraction = 4) BigDecimal maximumOrderQuantity,
      Unit quantityUnit,
      @Size(max = 1000) String notes,
      @NotNull Verification verificationStatus,
      @NotNull UUID observationId,
      @Min(0) long version) {}

  public record CapabilityView(
      UUID capabilityId,
      Proficiency proficiencyLevel,
      BigDecimal minimumOrderQuantity,
      BigDecimal maximumOrderQuantity,
      Unit quantityUnit,
      Verification verificationStatus,
      long version) {}

  private final FacilityRepository repository;
  private final JdbcClient jdbc;
  private final PlatformAuthorization auth;
  private final AuditRecorder audit;
  private final SourceService sources;
  private final SupplierService suppliers;

  public FacilityService(
      FacilityRepository repository,
      JdbcClient jdbc,
      PlatformAuthorization auth,
      AuditRecorder audit,
      SourceService sources,
      SupplierService suppliers) {
    this.repository = repository;
    this.jdbc = jdbc;
    this.auth = auth;
    this.audit = audit;
    this.sources = sources;
    this.suppliers = suppliers;
  }

  private FacilityEntity find(UUID id) {
    return repository.findById(id).orElseThrow(ValidationRules::missing);
  }

  private View view(FacilityEntity e) {
    return new View(
        e.id,
        e.supplierId,
        Type.valueOf(e.facilityType),
        e.name,
        e.countryId,
        e.regionId,
        e.industrialClusterId,
        e.addressLine1,
        e.addressLine2,
        e.postalCode,
        e.latitude,
        e.longitude,
        e.phone,
        e.email,
        Status.valueOf(e.status),
        e.version,
        e.createdAt,
        e.updatedAt);
  }

  public View read(UUID id) {
    return view(find(id));
  }

  private void apply(FacilityEntity e, Input v) {
    e.facilityType = v.facilityType().name();
    e.name = v.name().strip();
    e.countryId = v.countryId();
    e.regionId = v.regionId();
    e.industrialClusterId = v.industrialClusterId();
    e.addressLine1 = v.addressLine1();
    e.addressLine2 = v.addressLine2();
    e.postalCode = v.postalCode();
    e.latitude = v.latitude();
    e.longitude = v.longitude();
    e.phone = v.phone();
    e.email = v.email();
    e.status = v.status().name();
    e.updatedAt = Instant.now();
  }

  @Transactional
  public View create(Input v) {
    auth.requireAdmin();
    suppliers.read(v.supplierId());
    sources.requireObservation(v.observationId());
    var e = new FacilityEntity();
    e.id = UUID.randomUUID();
    e.supplierId = v.supplierId();
    e.createdAt = Instant.now();
    apply(e, v);
    e = repository.saveAndFlush(e);
    citation(e.id, new Citation(v.observationId(), Fact.RECORD));
    audit.changed("facility.created", "Facility", e.id, null, Map.of("name", e.name));
    return view(e);
  }

  @Transactional
  public View update(UUID id, Input v) {
    auth.requireAdmin();
    sources.requireObservation(v.observationId());
    var e = find(id);
    if (e.version != v.version()) throw ValidationRules.conflict();
    if (!e.supplierId.equals(v.supplierId()))
      throw ValidationRules.bad("Facility supplier cannot be reassigned");
    String before = e.name;
    apply(e, v);
    repository.flush();
    citation(id, new Citation(v.observationId(), Fact.RECORD));
    audit.changed(
        "facility.updated",
        "Facility",
        id,
        Map.of("name", before),
        Map.of("name", e.name, "status", e.status, "version", e.version));
    return view(e);
  }

  /** Identity Resolution is a persistent record binding; Fact Provenance is a separate citation. */
  @Transactional
  public View resolveIdentity(IdentityInput v) {
    auth.requireAdmin();
    sources.lockRecord(v.sourceRecordId(), SourceService.RecordKind.FACILITY);
    sources.requireObservationForRecord(v.facility().observationId(), v.sourceRecordId());
    var prior =
        jdbc.sql("SELECT facility_id FROM facility_external_record WHERE source_record_id=:id")
            .param("id", v.sourceRecordId())
            .query(UUID.class)
            .optional();
    if (prior.isPresent()) {
      citation(prior.get(), new Citation(v.facility().observationId(), Fact.RECORD));
      return read(prior.get());
    }
    var result = create(v.facility());
    jdbc.sql(
            "INSERT INTO facility_external_record(source_record_id,facility_id)"
                + " VALUES(:record,:facility)")
        .param("record", v.sourceRecordId())
        .param("facility", result.id())
        .update();
    audit.changed("facility.identity.bound", "Facility", result.id(), null, null);
    return result;
  }

  @Transactional
  public void bindIdentity(UUID facility, UUID record) {
    auth.requireAdmin();
    find(facility);
    sources.lockRecord(record, SourceService.RecordKind.FACILITY);
    var prior =
        jdbc.sql("SELECT facility_id FROM facility_external_record WHERE source_record_id=:id")
            .param("id", record)
            .query(UUID.class)
            .optional();
    if (prior.isPresent()) {
      if (!prior.get().equals(facility)) throw ValidationRules.conflict();
      return;
    }
    jdbc.sql(
            "INSERT INTO facility_external_record(source_record_id,facility_id)"
                + " VALUES(:record,:facility)")
        .param("record", record)
        .param("facility", facility)
        .update();
    audit.changed("facility.identity.bound", "Facility", facility, null, null);
  }

  @Transactional
  public void citation(UUID facility, Citation v) {
    auth.requireAdmin();
    int n =
        jdbc.sql(
                "INSERT INTO facility_source(facility_id,source_observation_id,field_name)"
                    + " VALUES(:id,:observation,:field) ON CONFLICT DO NOTHING")
            .param("id", facility)
            .param("observation", v.observationId())
            .param("field", v.fieldName().name())
            .update();
    if (n > 0)
      audit.changed(
          "facility.source.added",
          "Facility",
          facility,
          null,
          Map.of("observationId", v.observationId()));
  }

  @Transactional
  public void assign(UUID facility, UUID capability, CapabilityInput v) {
    auth.requireAdmin();
    find(facility);
    sources.requireObservation(v.observationId());
    ValidationRules.notes(v.notes());
    if ((v.minimumOrderQuantity() != null || v.maximumOrderQuantity() != null)
        && v.quantityUnit() == null) throw ValidationRules.bad("Quantity unit required");
    if (v.minimumOrderQuantity() != null
        && v.maximumOrderQuantity() != null
        && v.minimumOrderQuantity().compareTo(v.maximumOrderQuantity()) > 0)
      throw ValidationRules.bad("Invalid quantity range");
    int n =
        jdbc.sql(
                "INSERT INTO"
                    + " facility_capability(facility_id,capability_id,proficiency_level,minimum_order_quantity,maximum_order_quantity,quantity_unit,notes,verification_status)"
                    + " VALUES(:facility,:capability,:level,:min,:max,:unit,:notes,:verification)"
                    + " ON CONFLICT(facility_id,capability_id) DO UPDATE SET"
                    + " proficiency_level=EXCLUDED.proficiency_level,minimum_order_quantity=EXCLUDED.minimum_order_quantity,maximum_order_quantity=EXCLUDED.maximum_order_quantity,quantity_unit=EXCLUDED.quantity_unit,notes=EXCLUDED.notes,verification_status=EXCLUDED.verification_status,version=facility_capability.version+1,updated_at=now()"
                    + " WHERE facility_capability.version=:version")
            .param("facility", facility)
            .param("capability", capability)
            .param("level", v.proficiencyLevel() == null ? null : v.proficiencyLevel().name())
            .param("min", v.minimumOrderQuantity())
            .param("max", v.maximumOrderQuantity())
            .param("unit", v.quantityUnit() == null ? null : v.quantityUnit().name())
            .param("notes", v.notes())
            .param("verification", v.verificationStatus().name())
            .param("version", v.version())
            .update();
    if (n != 1) throw ValidationRules.conflict();
    jdbc.sql(
            "INSERT INTO"
                + " facility_capability_source(facility_id,capability_id,source_observation_id)"
                + " VALUES(:facility,:capability,:observation) ON CONFLICT DO NOTHING")
        .param("facility", facility)
        .param("capability", capability)
        .param("observation", v.observationId())
        .update();
    audit.changed(
        "facility.capability.assigned",
        "Facility",
        facility,
        null,
        Map.of("capabilityId", capability));
  }

  public List<CapabilityView> capabilities(UUID facility) {
    find(facility);
    return jdbc.sql(
            "SELECT * FROM facility_capability WHERE facility_id=:id ORDER BY capability_id LIMIT"
                + " 100")
        .param("id", facility)
        .query(
            (rs, n) ->
                new CapabilityView(
                    rs.getObject("capability_id", UUID.class),
                    rs.getString("proficiency_level") == null
                        ? null
                        : Proficiency.valueOf(rs.getString("proficiency_level")),
                    rs.getBigDecimal("minimum_order_quantity"),
                    rs.getBigDecimal("maximum_order_quantity"),
                    rs.getString("quantity_unit") == null
                        ? null
                        : Unit.valueOf(rs.getString("quantity_unit")),
                    Verification.valueOf(rs.getString("verification_status")),
                    rs.getLong("version")))
        .list();
  }

  public List<Map<String, Object>> citations(UUID facility) {
    auth.requireAdmin();
    return jdbc.sql(
            "SELECT source_observation_id,field_name,created_at FROM facility_source WHERE"
                + " facility_id=:id ORDER BY created_at DESC LIMIT 100")
        .param("id", facility)
        .query()
        .listOfRows();
  }
}
