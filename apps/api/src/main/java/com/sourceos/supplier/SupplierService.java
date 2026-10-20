package com.sourceos.supplier;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.authorization.PlatformAuthorization;
import com.sourceos.dataingestion.SourceService;
import com.sourceos.identity.IdentityService;
import com.sourceos.shared.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SupplierService {
  public enum Status {
    ACTIVE,
    ARCHIVED
  }

  public enum Role {
    MILL,
    CONVERTER,
    MATERIAL_SUPPLIER,
    TRIM_SUPPLIER,
    FACTORY,
    PROCESSOR,
    QC_COMPANY,
    LOGISTICS_COMPANY,
    OTHER
  }

  public enum Verification {
    DISCOVERED,
    CLAIMED,
    VERIFIED,
    AUDITED,
    TRANSACTED,
    PROVEN
  }

  public enum AliasType {
    ORIGINAL,
    ENGLISH,
    ROMANIZED,
    COMMERCIAL,
    OTHER
  }

  public enum Fact {
    RECORD,
    DISPLAY_NAME,
    LEGAL_NAME,
    NATIVE_NAME,
    ENGLISH_NAME,
    COUNTRY,
    WEBSITE_URL,
    DESCRIPTION,
    ROLE,
    ALIAS,
    VERIFICATION
  }

  @io.swagger.v3.oas.annotations.media.Schema(name = "SupplierInput")
  public record Input(
      @NotNull UUID countryId,
      @NotBlank @Size(max = 160) String displayName,
      @Size(max = 160) String legalName,
      @Size(max = 160) String nativeName,
      @Size(max = 160) String englishName,
      @Size(max = 100) String businessRegistrationNumber,
      @Size(max = 2000) String websiteUrl,
      @Size(max = 4000) String description,
      @NotNull Status status,
      @NotNull Set<@NotNull Role> roles,
      @NotNull UUID observationId,
      @Min(0) long version) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "SupplierView")
  public record View(
      UUID id,
      UUID countryId,
      String displayName,
      String legalName,
      String nativeName,
      String englishName,
      String businessRegistrationNumber,
      String websiteUrl,
      String description,
      Status status,
      Verification verificationStatus,
      Set<Role> roles,
      long version,
      Instant createdAt,
      Instant updatedAt) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "SupplierIdentityInput")
  public record IdentityInput(@NotNull UUID sourceRecordId, @NotNull @Valid Input supplier) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "SupplierAliasInput")
  public record AliasInput(
      @NotBlank @Size(max = 160) String alias,
      @Pattern(regexp = "[A-Za-z]{2,8}([-_][A-Za-z0-9]{1,8})*") String languageCode,
      @NotNull AliasType aliasType,
      @NotNull UUID observationId,
      @Min(0) long version) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "SupplierAliasView")
  public record AliasView(UUID id, String alias, String languageCode, AliasType aliasType) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "SupplierVerificationInput")
  public record VerificationInput(
      @NotNull Verification status,
      @NotBlank @Size(max = 1000) String reason,
      @NotNull UUID observationId,
      @Min(0) long version) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "SupplierVerificationEvent")
  public record VerificationEvent(
      UUID id,
      String previousStatus,
      Verification newStatus,
      String reason,
      String actorIssuer,
      String actorSubject,
      UUID observationId,
      Instant occurredAt) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "SupplierCitation")
  public record Citation(@NotNull UUID observationId, @NotNull Fact fieldName) {}

  private final SupplierRepository repository;
  private final JdbcClient jdbc;
  private final PlatformAuthorization auth;
  private final AuditRecorder audit;
  private final IdentityService identities;
  private final SourceService sources;

  public SupplierService(
      SupplierRepository repository,
      JdbcClient jdbc,
      PlatformAuthorization auth,
      AuditRecorder audit,
      IdentityService identities,
      SourceService sources) {
    this.repository = repository;
    this.jdbc = jdbc;
    this.auth = auth;
    this.audit = audit;
    this.identities = identities;
    this.sources = sources;
  }

  @Transactional(readOnly = true)
  public View read(UUID id) {
    return view(find(id));
  }

  private SupplierEntity find(UUID id) {
    return repository.findById(id).orElseThrow(ValidationRules::missing);
  }

  private View view(SupplierEntity e) {
    Set<Role> roles =
        new LinkedHashSet<>(
            jdbc
                .sql("SELECT role FROM supplier_role WHERE supplier_id=:id ORDER BY role")
                .param("id", e.id)
                .query(String.class)
                .list()
                .stream()
                .map(Role::valueOf)
                .toList());
    return new View(
        e.id,
        e.countryId,
        e.displayName,
        e.legalName,
        e.nativeName,
        e.englishName,
        e.businessRegistrationNumber,
        e.websiteUrl,
        e.description,
        Status.valueOf(e.status),
        Verification.valueOf(e.verificationStatus),
        roles,
        e.version,
        e.createdAt,
        e.updatedAt);
  }

  private void apply(SupplierEntity e, Input v) {
    ValidationRules.url(v.websiteUrl());
    e.countryId = v.countryId();
    e.displayName = v.displayName().strip();
    e.normalizedName = SearchText.normalize(v.displayName());
    e.legalName = v.legalName();
    e.nativeName = v.nativeName();
    e.englishName = v.englishName();
    e.businessRegistrationNumber = v.businessRegistrationNumber();
    e.websiteUrl = v.websiteUrl();
    e.description = v.description();
    e.status = v.status().name();
    e.updatedAt = Instant.now();
  }

  private void roles(UUID supplier, Set<Role> roles) {
    jdbc.sql("DELETE FROM supplier_role WHERE supplier_id=:id").param("id", supplier).update();
    for (Role role : roles)
      jdbc.sql("INSERT INTO supplier_role(supplier_id,role) VALUES(:id,:role)")
          .param("id", supplier)
          .param("role", role.name())
          .update();
  }

  private void event(SupplierEntity e, String before, String reason, UUID observation) {
    var actor = identities.current();
    jdbc.sql(
            "INSERT INTO"
                + " supplier_verification_event(id,supplier_id,previous_status,new_status,reason,actor_issuer,actor_subject,source_observation_id)"
                + " VALUES(:id,:supplier,:before,:after,:reason,:issuer,:subject,:observation)")
        .param("id", UUID.randomUUID())
        .param("supplier", e.id)
        .param("before", before)
        .param("after", e.verificationStatus)
        .param("reason", reason)
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .param("observation", observation)
        .update();
  }

  @Transactional
  public View create(Input v) {
    auth.requireAdmin();
    sources.requireObservation(v.observationId());
    var e = new SupplierEntity();
    e.id = UUID.randomUUID();
    e.createdAt = Instant.now();
    e.verificationStatus = "DISCOVERED";
    apply(e, v);
    e = repository.saveAndFlush(e);
    roles(e.id, v.roles());
    citation(e.id, new Citation(v.observationId(), Fact.RECORD));
    event(e, null, "Initial discovery", v.observationId());
    audit.changed(
        "supplier.created", "SupplierProfile", e.id, null, Map.of("displayName", e.displayName));
    return view(e);
  }

  @Transactional
  public View update(UUID id, Input v) {
    auth.requireAdmin();
    sources.requireObservation(v.observationId());
    var e = find(id);
    if (e.version != v.version()) throw ValidationRules.conflict();
    String before = e.displayName;
    apply(e, v);
    repository.flush();
    roles(e.id, v.roles());
    citation(id, new Citation(v.observationId(), Fact.RECORD));
    audit.changed(
        "supplier.updated",
        "SupplierProfile",
        id,
        Map.of("displayName", before),
        Map.of("displayName", e.displayName, "status", e.status, "version", e.version));
    return view(e);
  }

  /** Identity Resolution: bind the persistent record, never an observation or alias. */
  @Transactional
  public View resolveIdentity(IdentityInput v) {
    auth.requireAdmin();
    sources.lockRecord(v.sourceRecordId(), SourceService.RecordKind.SUPPLIER);
    sources.requireObservationForRecord(v.supplier().observationId(), v.sourceRecordId());
    var existing =
        jdbc.sql("SELECT supplier_id FROM supplier_external_record WHERE source_record_id=:id")
            .param("id", v.sourceRecordId())
            .query(UUID.class)
            .optional();
    if (existing.isPresent()) {
      citation(existing.get(), new Citation(v.supplier().observationId(), Fact.RECORD));
      return read(existing.get());
    }
    var result = create(v.supplier());
    jdbc.sql(
            "INSERT INTO supplier_external_record(source_record_id,supplier_id)"
                + " VALUES(:record,:supplier)")
        .param("record", v.sourceRecordId())
        .param("supplier", result.id())
        .update();
    audit.changed("supplier.identity.bound", "SupplierProfile", result.id(), null, null);
    return result;
  }

  @Transactional
  public void bindIdentity(UUID supplier, UUID record) {
    auth.requireAdmin();
    find(supplier);
    sources.lockRecord(record, SourceService.RecordKind.SUPPLIER);
    var prior =
        jdbc.sql("SELECT supplier_id FROM supplier_external_record WHERE source_record_id=:id")
            .param("id", record)
            .query(UUID.class)
            .optional();
    if (prior.isPresent()) {
      if (!prior.get().equals(supplier)) throw ValidationRules.conflict();
      return;
    }
    jdbc.sql(
            "INSERT INTO supplier_external_record(source_record_id,supplier_id)"
                + " VALUES(:record,:supplier)")
        .param("record", record)
        .param("supplier", supplier)
        .update();
    audit.changed("supplier.identity.bound", "SupplierProfile", supplier, null, null);
  }

  @Transactional
  public void citation(UUID supplier, Citation v) {
    auth.requireAdmin();
    int inserted =
        jdbc.sql(
                "INSERT INTO supplier_source(supplier_id,source_observation_id,field_name)"
                    + " VALUES(:id,:observation,:field) ON CONFLICT DO NOTHING")
            .param("id", supplier)
            .param("observation", v.observationId())
            .param("field", v.fieldName().name())
            .update();
    if (inserted > 0)
      audit.changed(
          "supplier.source.added",
          "SupplierProfile",
          supplier,
          null,
          Map.of("observationId", v.observationId()));
  }

  @Transactional
  public UUID alias(UUID id, AliasInput v) {
    auth.requireAdmin();
    sources.requireObservation(v.observationId());
    var e = find(id);
    if (e.version != v.version()) throw ValidationRules.conflict();
    e.updatedAt = Instant.now();
    repository.flush();
    UUID key = UUID.randomUUID();
    jdbc.sql(
            "INSERT INTO"
                + " supplier_alias(id,supplier_id,alias,normalized_alias,language_code,alias_type)"
                + " VALUES(:key,:id,:alias,:normalized,:language,:type)")
        .param("key", key)
        .param("id", id)
        .param("alias", v.alias())
        .param("normalized", SearchText.normalize(v.alias()))
        .param("language", v.languageCode())
        .param("type", v.aliasType().name())
        .update();
    citation(id, new Citation(v.observationId(), Fact.ALIAS));
    audit.changed("supplier.alias.added", "SupplierProfile", id, null, Map.of("name", v.alias()));
    return key;
  }

  @Transactional(readOnly = true)
  public List<AliasView> aliases(UUID supplier) {
    find(supplier);
    return jdbc.sql(
            "SELECT * FROM supplier_alias WHERE supplier_id=:id ORDER BY normalized_alias,id LIMIT"
                + " 100")
        .param("id", supplier)
        .query(
            (rs, n) ->
                new AliasView(
                    rs.getObject("id", UUID.class),
                    rs.getString("alias"),
                    rs.getString("language_code"),
                    AliasType.valueOf(rs.getString("alias_type"))))
        .list();
  }

  @Transactional
  public View verify(UUID id, VerificationInput v) {
    auth.requireAdmin();
    if (!Set.of(Verification.DISCOVERED, Verification.VERIFIED, Verification.AUDITED)
        .contains(v.status()))
      throw ValidationRules.bad("Status requires a future claim or transaction workflow");
    sources.requireObservation(v.observationId());
    ValidationRules.notes(v.reason());
    var e = find(id);
    if (e.version != v.version() || e.verificationStatus.equals(v.status().name()))
      throw ValidationRules.conflict();
    String before = e.verificationStatus;
    e.verificationStatus = v.status().name();
    e.updatedAt = Instant.now();
    repository.flush();
    event(e, before, v.reason(), v.observationId());
    citation(id, new Citation(v.observationId(), Fact.VERIFICATION));
    audit.changed(
        "supplier.verification.changed",
        "SupplierProfile",
        id,
        Map.of("verificationStatus", before),
        Map.of("verificationStatus", e.verificationStatus));
    return view(e);
  }

  public List<VerificationEvent> events(UUID supplier) {
    find(supplier);
    return jdbc.sql(
            "SELECT * FROM supplier_verification_event WHERE supplier_id=:id ORDER BY occurred_at"
                + " DESC,id DESC LIMIT 100")
        .param("id", supplier)
        .query(
            (rs, n) ->
                new VerificationEvent(
                    rs.getObject("id", UUID.class),
                    rs.getString("previous_status"),
                    Verification.valueOf(rs.getString("new_status")),
                    rs.getString("reason"),
                    rs.getString("actor_issuer"),
                    rs.getString("actor_subject"),
                    rs.getObject("source_observation_id", UUID.class),
                    rs.getObject("occurred_at", java.time.OffsetDateTime.class).toInstant()))
        .list();
  }

  public List<Map<String, Object>> citations(UUID supplier) {
    auth.requireAdmin();
    return jdbc.sql(
            "SELECT source_observation_id,field_name,created_at FROM supplier_source WHERE"
                + " supplier_id=:id ORDER BY created_at DESC LIMIT 100")
        .param("id", supplier)
        .query()
        .listOfRows();
  }
}
