package com.sourceos.materialinventory;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.authorization.PlatformAuthorization;
import com.sourceos.identity.IdentityService;
import com.sourceos.material.MaterialService;
import com.sourceos.materiallisting.ListingService;
import com.sourceos.shared.*;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.sql.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryService {
  public enum Mode {
    IMPORTED,
    MANUAL
  }

  @io.swagger.v3.oas.annotations.media.Schema(name = "InventoryInput")
  public record Input(
      @NotNull UUID listingId,
      UUID materialVariantId,
      UUID facilityId,
      @NotNull @DecimalMin("0") @Digits(integer = 15, fraction = 4) BigDecimal quantity,
      @NotNull MeasurementUnit unit,
      @NotNull Mode captureMode,
      @NotNull Instant observedAt,
      UUID sourceObservationId,
      @Size(max = 200) String manualIdempotencyKey) {
    public Input {
      if (observedAt != null) observedAt = observedAt.truncatedTo(ChronoUnit.MICROS);
    }
  }

  @io.swagger.v3.oas.annotations.media.Schema(name = "InventoryView")
  public record View(
      UUID id,
      UUID listingId,
      UUID materialId,
      UUID materialVariantId,
      UUID facilityId,
      BigDecimal quantity,
      MeasurementUnit unit,
      Mode captureMode,
      Instant observedAt,
      Instant recordedAt,
      UUID sourceObservationId,
      String manualIdempotencyKey,
      String actorIssuer,
      String actorSubject,
      Instant createdAt) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "InventoryFilter")
  public record Filter(
      UUID listingId,
      UUID variantId,
      UUID facilityId,
      MeasurementUnit unit,
      Mode captureMode,
      Instant asOf,
      boolean latest) {}

  private final JdbcClient jdbc;
  private final MaterialService materials;
  private final ListingService listings;
  private final PlatformAuthorization auth;
  private final IdentityService identities;
  private final AuditRecorder audit;

  public InventoryService(
      JdbcClient jdbc,
      MaterialService materials,
      ListingService listings,
      PlatformAuthorization auth,
      IdentityService identities,
      AuditRecorder audit) {
    this.jdbc = jdbc;
    this.materials = materials;
    this.listings = listings;
    this.auth = auth;
    this.identities = identities;
    this.audit = audit;
  }

  private View row(ResultSet r) throws SQLException {
    return new View(
        r.getObject("id", UUID.class),
        r.getObject("listing_id", UUID.class),
        r.getObject("material_id", UUID.class),
        r.getObject("material_variant_id", UUID.class),
        r.getObject("facility_id", UUID.class),
        r.getBigDecimal("quantity"),
        MeasurementUnit.valueOf(r.getString("unit")),
        Mode.valueOf(r.getString("capture_mode")),
        r.getObject("observed_at", OffsetDateTime.class).toInstant(),
        r.getObject("recorded_at", OffsetDateTime.class).toInstant(),
        r.getObject("source_observation_id", UUID.class),
        r.getString("manual_idempotency_key"),
        r.getString("actor_issuer"),
        r.getString("actor_subject"),
        r.getObject("created_at", OffsetDateTime.class).toInstant());
  }

  @Transactional
  public View create(Input v) {
    auth.requireAdmin();
    if (v.quantity() == null
        || v.unit() == null
        || v.observedAt() == null
        || v.captureMode() == null)
      throw ValidationRules.bad("Known quantity, unit, time and capture mode required");
    DecimalValues.quantity(v.quantity(), true);
    if (v.captureMode() == Mode.IMPORTED
        ? (v.sourceObservationId() == null || v.manualIdempotencyKey() != null)
        : (v.sourceObservationId() != null
            || v.manualIdempotencyKey() == null
            || v.manualIdempotencyKey().isBlank()
            || v.manualIdempotencyKey().length() > 200))
      throw ValidationRules.bad("Capture identity required for selected mode");
    ValidationRules.notes(v.manualIdempotencyKey());
    var l = listings.read(v.listingId());
    materials.requireVariant(v.materialVariantId(), l.materialId());
    var actor = identities.current();
    UUID id = UUID.randomUUID();
    int n =
        jdbc.sql(
                "INSERT INTO"
                    + " material_inventory_snapshot(id,listing_id,material_id,material_variant_id,facility_id,quantity,unit,capture_mode,observed_at,source_observation_id,manual_idempotency_key,actor_issuer,actor_subject)"
                    + " VALUES(:id,:listing,:material,:variant,:facility,:quantity,:unit,:mode,:observed,:observation,:key,:issuer,:subject)"
                    + " ON CONFLICT DO NOTHING")
            .param("id", id)
            .param("listing", v.listingId())
            .param("material", l.materialId())
            .param("variant", v.materialVariantId())
            .param("facility", v.facilityId())
            .param("quantity", v.quantity())
            .param("unit", v.unit().name())
            .param("mode", v.captureMode().name())
            .param("observed", Keysets.time(v.observedAt()))
            .param("observation", v.sourceObservationId())
            .param("key", v.manualIdempotencyKey())
            .param("issuer", actor.issuer())
            .param("subject", actor.subject())
            .update();
    var found =
        jdbc.sql(
                "SELECT * FROM material_inventory_snapshot WHERE listing_id=:listing AND"
                    + " ((capture_mode='IMPORTED' AND :mode='IMPORTED' AND material_variant_id IS"
                    + " NOT DISTINCT FROM CAST(:variant AS uuid) AND facility_id IS NOT DISTINCT"
                    + " FROM CAST(:facility AS uuid) AND source_observation_id=:observation) OR"
                    + " (capture_mode='MANUAL' AND :mode='MANUAL' AND"
                    + " manual_idempotency_key=:key))")
            .param("listing", v.listingId())
            .param("mode", v.captureMode().name())
            .param("variant", v.materialVariantId(), Types.OTHER)
            .param("facility", v.facilityId(), Types.OTHER)
            .param("observation", v.sourceObservationId(), Types.OTHER)
            .param("key", v.manualIdempotencyKey(), Types.VARCHAR)
            .query((r, i) -> row(r))
            .single();
    if (v.captureMode() == Mode.MANUAL
        && (!found.actorIssuer().equals(actor.issuer())
            || !found.actorSubject().equals(actor.subject()))) throw ValidationRules.conflict();
    if (!Objects.equals(found.materialVariantId(), v.materialVariantId())
        || !Objects.equals(found.facilityId(), v.facilityId())
        || found.quantity().compareTo(v.quantity()) != 0
        || found.unit() != v.unit()
        || !found.observedAt().equals(v.observedAt())) throw ValidationRules.conflict();
    if (n > 0)
      audit.changed(
          "material.inventory.recorded",
          "MaterialInventorySnapshot",
          id,
          null,
          Map.of(
              "listingId",
              v.listingId(),
              "quantity",
              v.quantity(),
              "unit",
              v.unit().name(),
              "captureMode",
              v.captureMode().name()));
    return found;
  }

  public Keysets.Page<View> list(Filter f, int limit, String cursor) {
    var l = listings.read(f.listingId());
    materials.requireVariant(f.variantId(), l.materialId());
    var a = Keysets.anchor(cursor, f, limit);
    String sql =
        """
        WITH snapshots AS (
        SELECT s.*,row_number() OVER(PARTITION BY s.material_variant_id,s.facility_id,s.unit,s.capture_mode,r.data_source_id ORDER BY s.observed_at DESC,s.recorded_at DESC,s.created_at DESC,s.id DESC) AS rn
        FROM material_inventory_snapshot s LEFT JOIN data_source_observation o ON o.id=s.source_observation_id LEFT JOIN data_source_record r ON r.id=o.source_record_id
        WHERE s.listing_id=:listing AND (CAST(:variant AS uuid) IS NULL OR s.material_variant_id=:variant) AND (CAST(:facility AS uuid) IS NULL OR s.facility_id=:facility) AND (CAST(:unit AS text) IS NULL OR s.unit=:unit) AND (CAST(:mode AS text) IS NULL OR s.capture_mode=:mode) AND (CAST(:asof AS timestamptz) IS NULL OR s.observed_at<=:asof)
        ) SELECT * FROM snapshots WHERE (NOT :latest OR rn=1) AND (CAST(:at AS timestamptz) IS NULL OR (created_at,id)<(CAST(:at AS timestamptz),CAST(:anchor AS uuid))) ORDER BY created_at DESC,id DESC LIMIT :limit
        """;
    var rows =
        jdbc.sql(sql)
            .param("listing", f.listingId())
            .param("variant", f.variantId(), Types.OTHER)
            .param("facility", f.facilityId(), Types.OTHER)
            .param("unit", f.unit() == null ? null : f.unit().name(), Types.VARCHAR)
            .param("mode", f.captureMode() == null ? null : f.captureMode().name(), Types.VARCHAR)
            .param("asof", Keysets.time(f.asOf()), Types.TIMESTAMP_WITH_TIMEZONE)
            .param("latest", f.latest())
            .param("at", Keysets.time(a.at()), Types.TIMESTAMP_WITH_TIMEZONE)
            .param("anchor", a.id(), Types.OTHER)
            .param("limit", limit + 1)
            .query((r, i) -> row(r))
            .list();
    return Keysets.page(rows, limit, f, View::createdAt, View::id);
  }
}
