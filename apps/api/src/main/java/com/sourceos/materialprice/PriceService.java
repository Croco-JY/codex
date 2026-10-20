package com.sourceos.materialprice;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.authorization.PlatformAuthorization;
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
public class PriceService {
  public record Input(
      @NotNull UUID listingId,
      UUID materialVariantId,
      @NotNull UUID dataSourceId,
      @NotNull @DecimalMin(value = "0", inclusive = false) @Digits(integer = 15, fraction = 4)
          BigDecimal amount,
      @NotBlank String currency,
      @NotNull MeasurementUnit priceUnit,
      @DecimalMin("0") @Digits(integer = 15, fraction = 4) BigDecimal minimumOrderQuantity,
      @NotNull Instant validFrom,
      Instant validTo,
      @NotNull Instant observedAt,
      @Size(max = 100) List<@NotNull UUID> observationIds) {
    public Input {
      validFrom = micros(validFrom);
      validTo = micros(validTo);
      observedAt = micros(observedAt);
    }
  }

  public record View(
      UUID id,
      UUID listingId,
      UUID materialId,
      UUID materialVariantId,
      UUID dataSourceId,
      BigDecimal amount,
      String currency,
      MeasurementUnit priceUnit,
      BigDecimal minimumOrderQuantity,
      Instant validFrom,
      Instant validTo,
      Instant observedAt,
      long version,
      Instant updatedAt,
      Instant createdAt) {}

  public record CloseInput(@NotNull Instant validTo, @Min(0) long version) {
    public CloseInput {
      validTo = micros(validTo);
    }
  }

  public record Evidence(@NotNull UUID observationId) {}

  public record EvidenceView(UUID observationId, Instant createdAt) {}

  public record ImportInput(
      @NotNull UUID observationId,
      @NotBlank @Size(max = 200) String itemKey,
      @NotNull @jakarta.validation.Valid Input price) {}

  public record HistoryFilter(
      UUID listingId, UUID dataSourceId, String currency, MeasurementUnit unit) {}

  public record MatchRequest(
      UUID requestedVariantId,
      BigDecimal requestedQuantity,
      String currency,
      MeasurementUnit priceUnit,
      Instant asOf,
      boolean allowMaterialFallback,
      UUID dataSourceId) {
    public MatchRequest {
      asOf = micros(asOf);
      if (requestedQuantity != null) requestedQuantity = requestedQuantity.stripTrailingZeros();
    }
  }

  public enum MatchStatus {
    MATCHED,
    NO_MATCH
  }

  public enum MatchScope {
    VARIANT_EXACT,
    MATERIAL_FALLBACK,
    MATERIAL_EXACT,
    NO_MATCH
  }

  public enum Eligibility {
    ELIGIBLE,
    INELIGIBLE,
    UNKNOWN_TERMS,
    NOT_EVALUATED_FOR_HISTORICAL_QUERY
  }

  public enum TermsScope {
    CURRENT_TERMS_ONLY,
    HISTORICAL_TERMS_NOT_RECONSTRUCTED
  }

  public record Outcome(
      UUID dataSourceId,
      String currency,
      MeasurementUnit priceUnit,
      MatchStatus priceMatch,
      MatchScope matchScope,
      View price,
      Eligibility commercialEligibility,
      String eligibilityReason) {}

  public record Resolution(
      Instant asOf,
      MatchStatus priceMatch,
      TermsScope listingTermsScope,
      ListingService.View currentListingTerms,
      List<Outcome> scopes,
      String nextCursor) {}

  private record ScopeFilter(UUID listing, MatchRequest request) {}

  private record ScopeRow(UUID source, String currency, MeasurementUnit unit, View price) {}

  private final JdbcClient jdbc;
  private final ListingService listings;
  private final MaterialService materials;
  private final PlatformAuthorization auth;
  private final AuditRecorder audit;

  public PriceService(
      JdbcClient jdbc,
      ListingService listings,
      MaterialService materials,
      PlatformAuthorization auth,
      AuditRecorder audit) {
    this.jdbc = jdbc;
    this.listings = listings;
    this.materials = materials;
    this.auth = auth;
    this.audit = audit;
  }

  private static Instant micros(Instant v) {
    return v == null ? null : v.truncatedTo(ChronoUnit.MICROS);
  }

  public static String currency(String value) {
    try {
      if (value == null || !value.matches("[A-Z]{3}")) throw new IllegalArgumentException();
      var c = Currency.getInstance(value);
      if (Set.of("XXX", "XTS").contains(value) || c.getDefaultFractionDigits() < 0)
        throw new IllegalArgumentException();
      return c.getCurrencyCode();
    } catch (IllegalArgumentException e) {
      throw ValidationRules.bad("Unrecognized commercial currency");
    }
  }

  private static Instant at(ResultSet r, String key) throws SQLException {
    var value = r.getObject(key, OffsetDateTime.class);
    return value == null ? null : value.toInstant();
  }

  private View row(ResultSet r) throws SQLException {
    return new View(
        r.getObject("id", UUID.class),
        r.getObject("listing_id", UUID.class),
        r.getObject("material_id", UUID.class),
        r.getObject("material_variant_id", UUID.class),
        r.getObject("data_source_id", UUID.class),
        r.getBigDecimal("amount"),
        r.getString("currency"),
        MeasurementUnit.valueOf(r.getString("price_unit")),
        r.getBigDecimal("minimum_order_quantity"),
        at(r, "valid_from"),
        at(r, "valid_to"),
        at(r, "observed_at"),
        r.getLong("version"),
        at(r, "updated_at"),
        at(r, "created_at"));
  }

  public View read(UUID id) {
    return jdbc.sql("SELECT * FROM material_price WHERE id=:id")
        .param("id", id)
        .query((r, n) -> row(r))
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  private boolean equal(BigDecimal a, BigDecimal b) {
    return a == null ? b == null : b != null && a.compareTo(b) == 0;
  }

  private boolean same(View p, Input v, UUID material) {
    return p.listingId().equals(v.listingId())
        && p.materialId().equals(material)
        && Objects.equals(p.materialVariantId(), v.materialVariantId())
        && p.dataSourceId().equals(v.dataSourceId())
        && equal(p.amount(), v.amount())
        && p.currency().equals(v.currency())
        && p.priceUnit() == v.priceUnit()
        && equal(p.minimumOrderQuantity(), v.minimumOrderQuantity())
        && p.validFrom().equals(v.validFrom())
        && p.observedAt().equals(v.observedAt());
  }

  @Transactional
  public View create(Input v, UUID commandId) {
    auth.requireAdmin();
    DecimalValues.quantity(v.amount(), false);
    if (v.amount() == null) throw ValidationRules.bad("Price amount required");
    DecimalValues.quantity(v.minimumOrderQuantity(), true);
    currency(v.currency());
    if (v.validFrom() == null
        || v.observedAt() == null
        || v.priceUnit() == null
        || (v.validTo() != null && !v.validTo().isAfter(v.validFrom())))
      throw ValidationRules.bad("Invalid price interval/unit");
    var listing = listings.read(v.listingId());
    materials.requireVariant(v.materialVariantId(), listing.materialId());
    UUID id = commandId == null ? UUID.randomUUID() : commandId;
    int n =
        jdbc.sql(
                "INSERT INTO"
                    + " material_price(id,listing_id,material_id,material_variant_id,data_source_id,amount,currency,price_unit,minimum_order_quantity,valid_from,valid_to,observed_at)"
                    + " VALUES(:id,:listing,:material,:variant,:source,:amount,:currency,:unit,:moq,:from,:to,:observed)"
                    + " ON CONFLICT(id) DO NOTHING")
            .param("id", id)
            .param("listing", v.listingId())
            .param("material", listing.materialId())
            .param("variant", v.materialVariantId())
            .param("source", v.dataSourceId())
            .param("amount", v.amount())
            .param("currency", v.currency())
            .param("unit", v.priceUnit().name())
            .param("moq", v.minimumOrderQuantity())
            .param("from", Keysets.time(v.validFrom()))
            .param("to", Keysets.time(v.validTo()))
            .param("observed", Keysets.time(v.observedAt()))
            .update();
    var result = read(id);
    if (n == 0) {
      if (!same(result, v, listing.materialId())) throw ValidationRules.conflict();
      return result;
    }
    if (v.observationIds() != null)
      for (UUID observation : v.observationIds()) cite(id, new Evidence(observation));
    audit.changed(
        "material.price.created",
        "MaterialPrice",
        id,
        null,
        Map.of(
            "listingId",
            v.listingId(),
            "sourceId",
            v.dataSourceId(),
            "amount",
            v.amount(),
            "currency",
            v.currency(),
            "unit",
            v.priceUnit().name()));
    return result;
  }

  @Transactional
  public View importPrice(ImportInput v) {
    auth.requireAdmin();
    var provider =
        jdbc.sql(
                "SELECT r.data_source_id FROM data_source_observation o JOIN data_source_record r"
                    + " ON r.id=o.source_record_id WHERE o.id=:id")
            .param("id", v.observationId())
            .query(UUID.class)
            .optional()
            .orElseThrow(ValidationRules::missing);
    if (!provider.equals(v.price().dataSourceId()))
      throw ValidationRules.bad("Observation provider mismatch");
    ValidationRules.notes(v.itemKey());
    UUID command =
        UUID.nameUUIDFromBytes(
            ("source-os/material-price/v1\n" + v.observationId() + "\n" + v.itemKey())
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
    List<UUID> evidence =
        new ArrayList<>(
            v.price().observationIds() == null ? List.of() : v.price().observationIds());
    if (!evidence.contains(v.observationId())) evidence.add(v.observationId());
    var p = v.price();
    return create(
        new Input(
            p.listingId(),
            p.materialVariantId(),
            p.dataSourceId(),
            p.amount(),
            p.currency(),
            p.priceUnit(),
            p.minimumOrderQuantity(),
            p.validFrom(),
            p.validTo(),
            p.observedAt(),
            evidence),
        command);
  }

  @Transactional
  public View close(UUID id, CloseInput v) {
    auth.requireAdmin();
    var p = read(id);
    if (v.validTo() == null || !v.validTo().isAfter(p.validFrom()))
      throw ValidationRules.bad("Invalid close interval");
    int n =
        jdbc.sql(
                "UPDATE material_price SET valid_to=:to,version=version+1 WHERE id=:id AND"
                    + " version=:version AND valid_to IS NULL")
            .param("to", Keysets.time(v.validTo()))
            .param("id", id)
            .param("version", v.version())
            .update();
    if (n != 1) throw ValidationRules.conflict();
    audit.changed(
        "material.price.closed",
        "MaterialPrice",
        id,
        null,
        Map.of("validTo", v.validTo().toString(), "version", v.version() + 1));
    return read(id);
  }

  @Transactional
  public void cite(UUID id, Evidence v) {
    auth.requireAdmin();
    read(id);
    int n =
        jdbc.sql(
                "INSERT INTO material_price_source(material_price_id,source_observation_id)"
                    + " VALUES(:id,:observation) ON CONFLICT DO NOTHING")
            .param("id", id)
            .param("observation", v.observationId())
            .update();
    if (n > 0)
      audit.changed(
          "material.price.source.added",
          "MaterialPrice",
          id,
          null,
          Map.of("observationId", v.observationId()));
  }

  public List<EvidenceView> evidence(UUID id, int limit, int offset) {
    auth.requireAdmin();
    read(id);
    ValidationRules.page(limit, offset);
    return jdbc.sql(
            "SELECT source_observation_id,created_at FROM material_price_source WHERE"
                + " material_price_id=:id ORDER BY created_at DESC,source_observation_id LIMIT"
                + " :limit OFFSET :offset")
        .param("id", id)
        .param("limit", limit)
        .param("offset", offset)
        .query(
            (r, n) ->
                new EvidenceView(
                    r.getObject(1, UUID.class), r.getObject(2, OffsetDateTime.class).toInstant()))
        .list();
  }

  public Keysets.Page<View> history(HistoryFilter f, int limit, String cursor) {
    listings.read(f.listingId());
    if (f.currency() != null) currency(f.currency());
    var a = Keysets.anchor(cursor, f, limit);
    var rows =
        jdbc.sql(
                "SELECT * FROM material_price WHERE listing_id=:listing AND (CAST(:source AS uuid)"
                    + " IS NULL OR data_source_id=:source) AND (CAST(:currency AS text) IS NULL OR"
                    + " currency=:currency) AND (CAST(:unit AS text) IS NULL OR price_unit=:unit)"
                    + " AND (CAST(:at AS timestamptz) IS NULL OR (created_at,id)<(CAST(:at AS"
                    + " timestamptz),CAST(:anchor AS uuid))) ORDER BY created_at DESC,id DESC LIMIT"
                    + " :limit")
            .param("listing", f.listingId())
            .param("source", f.dataSourceId(), Types.OTHER)
            .param("currency", f.currency(), Types.VARCHAR)
            .param("unit", f.unit() == null ? null : f.unit().name(), Types.VARCHAR)
            .param("at", Keysets.time(a.at()), Types.TIMESTAMP_WITH_TIMEZONE)
            .param("anchor", a.id(), Types.OTHER)
            .param("limit", limit + 1)
            .query((r, n) -> row(r))
            .list();
    return Keysets.page(rows, limit, f, View::createdAt, View::id);
  }

  private Eligibility eligibility(
      ListingService.View listing, MatchRequest request, MeasurementUnit unit) {
    if (request.asOf() != null) return Eligibility.NOT_EVALUATED_FOR_HISTORICAL_QUERY;
    if (listing.status() == ListingService.Status.ARCHIVED) return Eligibility.INELIGIBLE;
    if (request.requestedQuantity() == null
        || listing.minimumOrderQuantity() == null
        || listing.quantityUnit() == null
        || listing.quantityUnit() != unit) return Eligibility.UNKNOWN_TERMS;
    return request.requestedQuantity().compareTo(listing.minimumOrderQuantity()) >= 0
        ? Eligibility.ELIGIBLE
        : Eligibility.INELIGIBLE;
  }

  public Resolution resolve(UUID listingId, MatchRequest request, int limit, String cursor) {
    Keysets.limit(limit);
    DecimalValues.quantity(request.requestedQuantity(), false);
    if (request.currency() != null) currency(request.currency());
    var listing = listings.read(listingId);
    materials.requireVariant(request.requestedVariantId(), listing.materialId());
    String hash = Keysets.hash(new ScopeFilter(listingId, request));
    String raw = Keysets.decode("price-scopes", hash, cursor);
    Instant asOf = request.asOf() == null ? micros(Instant.now()) : request.asOf();
    UUID anchorSource = null;
    String anchorCurrency = null, anchorUnit = null;
    if (raw != null) {
      try {
        var p = raw.split("\\|", -1);
        if (p.length != 4) throw new IllegalArgumentException();
        Instant encoded = Instant.parse(p[0]);
        if (request.asOf() != null && !request.asOf().equals(encoded))
          throw new IllegalArgumentException();
        asOf = encoded;
        anchorSource = Keysets.uuid(p[1]);
        if (!p[2].matches("[A-Z]{3}")) throw new IllegalArgumentException();
        anchorCurrency = p[2];
        anchorUnit = MeasurementUnit.valueOf(p[3]).name();
      } catch (IllegalArgumentException | DateTimeException e) {
        throw ValidationRules.bad("Invalid price scope cursor");
      }
    }
    String sql =
        """
        WITH scopes AS (
        SELECT DISTINCT data_source_id,currency,price_unit FROM material_price
        WHERE listing_id=:listing AND (CAST(:provider AS uuid) IS NULL OR data_source_id=:provider)
        AND (CAST(:currency AS text) IS NULL OR currency=:currency) AND (CAST(:unit AS text) IS NULL OR price_unit=:unit)
        ), ranked AS (
        SELECT p.*,row_number() OVER(PARTITION BY p.data_source_id,p.currency,p.price_unit
        ORDER BY CASE WHEN p.material_variant_id IS NOT DISTINCT FROM CAST(:variant AS uuid) THEN 0 ELSE 1 END,
        p.minimum_order_quantity DESC NULLS LAST,p.valid_from DESC,p.observed_at DESC,p.created_at DESC,p.id DESC) AS rn
        FROM material_price p WHERE p.listing_id=:listing AND p.valid_from<=:asof AND (p.valid_to IS NULL OR p.valid_to>:asof)
        AND ((CAST(:variant AS uuid) IS NULL AND p.material_variant_id IS NULL) OR (CAST(:variant AS uuid) IS NOT NULL AND (p.material_variant_id=:variant OR (:fallback AND p.material_variant_id IS NULL))))
        AND (p.minimum_order_quantity IS NULL OR (CAST(:quantity AS numeric) IS NOT NULL AND p.minimum_order_quantity<=:quantity))
        ) SELECT s.data_source_id AS scope_provider,s.currency AS scope_currency,s.price_unit AS scope_unit,p.*
        FROM scopes s LEFT JOIN ranked p ON p.data_source_id=s.data_source_id AND p.currency=s.currency AND p.price_unit=s.price_unit AND p.rn=1
        WHERE (CAST(:anchorSource AS uuid) IS NULL OR (s.data_source_id,s.currency,s.price_unit)>(CAST(:anchorSource AS uuid),CAST(:anchorCurrency AS text),CAST(:anchorUnit AS text)))
        ORDER BY s.data_source_id,s.currency,s.price_unit LIMIT :limit
        """;
    var rows =
        jdbc.sql(sql)
            .param("listing", listingId)
            .param("provider", request.dataSourceId(), Types.OTHER)
            .param("currency", request.currency(), Types.VARCHAR)
            .param(
                "unit",
                request.priceUnit() == null ? null : request.priceUnit().name(),
                Types.VARCHAR)
            .param("variant", request.requestedVariantId(), Types.OTHER)
            .param("fallback", request.allowMaterialFallback())
            .param("quantity", request.requestedQuantity(), Types.NUMERIC)
            .param("asof", Keysets.time(asOf))
            .param("anchorSource", anchorSource, Types.OTHER)
            .param("anchorCurrency", anchorCurrency, Types.VARCHAR)
            .param("anchorUnit", anchorUnit, Types.VARCHAR)
            .param("limit", limit + 1)
            .query(
                (r, n) ->
                    new ScopeRow(
                        r.getObject("scope_provider", UUID.class),
                        r.getString("scope_currency"),
                        MeasurementUnit.valueOf(r.getString("scope_unit")),
                        r.getObject("id") == null ? null : row(r)))
            .list();
    boolean more = rows.size() > limit;
    var selected = rows.subList(0, Math.min(limit, rows.size()));
    List<Outcome> outcomes = new ArrayList<>();
    for (var scope : selected) {
      var p = scope.price();
      MatchScope match =
          p == null
              ? MatchScope.NO_MATCH
              : request.requestedVariantId() == null
                  ? MatchScope.MATERIAL_EXACT
                  : p.materialVariantId() == null
                      ? MatchScope.MATERIAL_FALLBACK
                      : MatchScope.VARIANT_EXACT;
      var eligible = eligibility(listing, request, scope.unit());
      outcomes.add(
          new Outcome(
              scope.source(),
              scope.currency(),
              scope.unit(),
              p == null ? MatchStatus.NO_MATCH : MatchStatus.MATCHED,
              match,
              p,
              eligible,
              eligible == Eligibility.NOT_EVALUATED_FOR_HISTORICAL_QUERY
                  ? "HISTORICAL_LISTING_TERMS_NOT_RECONSTRUCTED"
                  : eligible == Eligibility.UNKNOWN_TERMS
                      ? "CURRENT_MOQ_OR_COMPARABLE_QUANTITY_UNKNOWN"
                      : "CURRENT_MOQ_ONLY_MCQ_NOT_EVALUATED"));
    }
    var last = selected.isEmpty() ? null : selected.getLast();
    String next =
        more
            ? Keysets.encode(
                "price-scopes",
                hash,
                asOf + "|" + last.source() + "|" + last.currency() + "|" + last.unit())
            : null;
    return new Resolution(
        asOf,
        outcomes.stream().anyMatch(o -> o.priceMatch() == MatchStatus.MATCHED)
            ? MatchStatus.MATCHED
            : MatchStatus.NO_MATCH,
        request.asOf() == null
            ? TermsScope.CURRENT_TERMS_ONLY
            : TermsScope.HISTORICAL_TERMS_NOT_RECONSTRUCTED,
        listing,
        List.copyOf(outcomes),
        next);
  }
}
