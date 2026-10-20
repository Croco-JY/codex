package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.materiallisting.ListingService;
import com.sourceos.materialprice.PriceService;
import com.sourceos.shared.MeasurementUnit;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class MaterialPriceTest extends CatalogIntegrationSupport {
  @Autowired PriceService prices;
  static final Instant FROM = Instant.parse("2025-01-01T00:00:00Z"),
      AT = Instant.parse("2026-01-01T00:00:00Z");

  PriceService.Input input(
      UUID l, UUID v, String amount, String moq, String currency, MeasurementUnit unit) {
    return new PriceService.Input(
        l,
        v,
        source,
        new BigDecimal(amount),
        currency,
        unit,
        moq == null ? null : new BigDecimal(moq),
        FROM,
        null,
        FROM,
        List.of(observation));
  }

  PriceService.View price(UUID l, UUID v, String amount, String moq) {
    return prices.create(input(l, v, amount, moq, "USD", MeasurementUnit.METER), null);
  }

  PriceService.MatchRequest request(UUID v, String q, boolean fallback, Instant at) {
    return new PriceService.MatchRequest(
        v, q == null ? null : new BigDecimal(q), null, null, at, fallback, null);
  }

  PriceService.Outcome match(UUID l, UUID v, String q, boolean fallback) {
    return prices.resolve(l, request(v, q, fallback, AT), 25, null).scopes().getFirst();
  }

  @Test
  void positiveAmountsAndCommercialCurrencies() {
    var l = listing(material().id());
    for (String amount : List.of("0", "-1", "1.12345"))
      assertThatThrownBy(() -> price(l.id(), null, amount, null))
          .isInstanceOf(RuntimeException.class);
    for (String c : List.of("XXX", "XTS", "ABC", "usd", "US", "XAU"))
      assertThatThrownBy(
              () -> prices.create(input(l.id(), null, "1", null, c, MeasurementUnit.METER), null))
          .hasMessageContaining("currency");
    for (var u : MeasurementUnit.values())
      assertThat(prices.create(input(l.id(), null, "1", null, "JPY", u), null).priceUnit())
          .isEqualTo(u);
    var p = price(l.id(), null, "1", null);
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        "INSERT INTO"
                            + " material_price(id,listing_id,material_id,data_source_id,amount,currency,price_unit,valid_from,observed_at)"
                            + " SELECT"
                            + " gen_random_uuid(),listing_id,material_id,data_source_id,0,currency,price_unit,valid_from,observed_at"
                            + " FROM material_price WHERE id=:id")
                    .param("id", p.id())
                    .update())
        .hasMessageContaining("check");
  }

  @Test
  void compositeForeignKeysRejectOtherListingMaterialAndVariant() {
    var a = material();
    var b = material();
    var l = listing(a.id());
    var v = variant(b.id());
    assertThatThrownBy(() -> price(l.id(), v.id(), "1", null)).isInstanceOf(RuntimeException.class);
    var p = price(l.id(), null, "1", null);
    for (String fields : List.of("material_id", "material_variant_id")) {
      UUID other = fields.equals("material_id") ? b.id() : v.id();
      assertThatThrownBy(
              () ->
                  jdbc.sql(
                          "INSERT INTO material_price SELECT gen_random_uuid(),listing_id,"
                              + (fields.equals("material_id") ? ":other" : "material_id")
                              + ","
                              + (fields.equals("material_variant_id") ? ":other" : "NULL")
                              + ",data_source_id,amount,currency,price_unit,minimum_order_quantity,valid_from,valid_to,observed_at,version,updated_at,created_at"
                              + " FROM material_price WHERE id=:id")
                      .param("id", p.id())
                      .param("other", other)
                      .update())
          .hasMessageContaining("foreign key");
    }
  }

  @Test
  void allTwelveImmutableFieldsAndNoOpDeletionTruncationAreRejected() {
    var l = listing(material().id());
    var p = price(l.id(), null, "10", null);
    Map<String, String> changes = new LinkedHashMap<>();
    for (String c :
        List.of("id", "listing_id", "material_id", "material_variant_id", "data_source_id"))
      changes.put(c, "gen_random_uuid()");
    changes.put("amount", "11");
    changes.put("currency", "'JPY'");
    changes.put("price_unit", "'YARD'");
    changes.put("minimum_order_quantity", "1");
    for (String c : List.of("valid_from", "observed_at", "created_at"))
      changes.put(c, c + "+interval '1 second'");
    assertThat(changes).hasSize(12);
    changes.forEach(
        (c, v) ->
            assertThatThrownBy(
                    () ->
                        jdbc.sql(
                                "UPDATE material_price SET "
                                    + c
                                    + "="
                                    + v
                                    + ",valid_to=valid_from+interval '1 day',version=version+1"
                                    + " WHERE id=:id")
                            .param("id", p.id())
                            .update())
                .hasMessageContaining("immutable"));
    for (String sql :
        List.of(
            "UPDATE material_price SET amount=amount WHERE id=:id",
            "DELETE FROM material_price WHERE id=:id",
            "TRUNCATE material_price CASCADE"))
      assertThatThrownBy(() -> jdbc.sql(sql).param("id", p.id()).update())
          .isInstanceOf(RuntimeException.class);
  }

  @Test
  void onlyOneVersionedClosureWithDatabaseClock() {
    var l = listing(material().id());
    var p = price(l.id(), null, "1", null);
    assertThatThrownBy(() -> prices.close(p.id(), new PriceService.CloseInput(AT, 3)))
        .hasMessageContaining("conflict");
    Instant before = Instant.now().minusSeconds(1);
    var closed = prices.close(p.id(), new PriceService.CloseInput(AT, 0));
    assertThat(closed.validTo()).isEqualTo(AT);
    assertThat(closed.version()).isEqualTo(1);
    assertThat(closed.updatedAt()).isAfter(before);
    for (String value :
        List.of("NULL", "valid_to", "valid_to+interval '1 day'", "valid_to-interval '1 day'"))
      assertThatThrownBy(
              () ->
                  jdbc.sql(
                          "UPDATE material_price SET valid_to="
                              + value
                              + ",version=version+1 WHERE id=:id")
                      .param("id", p.id())
                      .update())
          .hasMessageContaining("close once");
  }

  @Test
  void priceSourcesMustBeActualObservationsFromSameProviderAndAppendOnly() {
    var p = price(listing(material().id()).id(), null, "1", null);
    UUID other =
        sources.source(
            null,
            new com.sourceos.dataingestion.SourceService.SourceInput(
                "other-" + id(),
                com.sourceos.dataingestion.SourceService.SourceType.MANUAL_ENTRY,
                "Synthetic price provider",
                null,
                null,
                com.sourceos.dataingestion.SourceService.AccessMethod.MANUAL,
                com.sourceos.dataingestion.SourceService.Normalization.PRESERVE,
                true,
                0));
    UUID r =
        sources
            .record(
                new com.sourceos.dataingestion.SourceService.RecordInput(
                    other,
                    com.sourceos.dataingestion.SourceService.RecordKind.SUPPLIER,
                    "different-provider"))
            .id();
    UUID o = observation(r);
    assertThatThrownBy(() -> prices.cite(p.id(), new PriceService.Evidence(o)))
        .hasMessageContaining("provider mismatch");
    assertThatThrownBy(() -> prices.cite(p.id(), new PriceService.Evidence(record)))
        .hasMessageContaining("provider mismatch");
    for (String sql :
        List.of(
            "UPDATE material_price_source SET created_at=created_at",
            "DELETE FROM material_price_source",
            "TRUNCATE material_price_source"))
      assertThatThrownBy(() -> jdbc.sql(sql).update()).hasMessageContaining("append-only");
  }

  @Test
  void commandIdRetriesCompareImmutableFactsAndDoNotDuplicateAudit() {
    var l = listing(material().id());
    UUID command = UUID.randomUUID();
    var in = input(l.id(), null, "3.00", null, "USD", MeasurementUnit.METER);
    var first = prices.create(in, command);
    long count =
        jdbc.sql("SELECT count(*) FROM audit_event WHERE entity_id=:id")
            .param("id", command)
            .query(Long.class)
            .single();
    assertThat(
            prices
                .create(input(l.id(), null, "3.0000", null, "USD", MeasurementUnit.METER), command)
                .id())
        .isEqualTo(first.id());
    assertThat(
            jdbc.sql("SELECT count(*) FROM audit_event WHERE entity_id=:id")
                .param("id", command)
                .query(Long.class)
                .single())
        .isEqualTo(count);
    assertThatThrownBy(
            () ->
                prices.create(
                    input(l.id(), null, "4", null, "USD", MeasurementUnit.METER), command))
        .hasMessageContaining("conflict");
    prices.close(command, new PriceService.CloseInput(AT, 0));
    assertThat(prices.create(in, command).validTo()).isEqualTo(AT);
  }

  @Test
  void importedPriceUsesStableObservationAndItemIdentity() {
    var l = listing(material().id());
    var in =
        new PriceService.ImportInput(
            observation, "tier-1", input(l.id(), null, "2", null, "USD", MeasurementUnit.METER));
    assertThat(prices.importPrice(in).id()).isEqualTo(prices.importPrice(in).id());
    assertThat(prices.evidence(prices.importPrice(in).id(), 25, 0)).hasSize(1);
  }

  @Test
  void variantExactAndExplicitFallbackAndNoVariantIsMaterialOnly() {
    var m = material();
    var l = listing(m.id());
    var v = variant(m.id());
    var base = price(l.id(), null, "5", null);
    assertThat(match(l.id(), v.id(), null, false).priceMatch())
        .isEqualTo(PriceService.MatchStatus.NO_MATCH);
    assertThat(match(l.id(), v.id(), null, true).price().id()).isEqualTo(base.id());
    assertThat(match(l.id(), v.id(), null, true).matchScope())
        .isEqualTo(PriceService.MatchScope.MATERIAL_FALLBACK);
    var exact = price(l.id(), v.id(), "100", null);
    assertThat(match(l.id(), v.id(), null, true).price().id()).isEqualTo(exact.id());
    assertThat(match(l.id(), null, null, false).price().id()).isEqualTo(base.id());
  }

  @Test
  void tiersQuantityOmittedBaseFallbackAndExplicitZeroTier() {
    var l = listing(material().id());
    var base = price(l.id(), null, "100", null);
    var zero = price(l.id(), null, "90", "0");
    var ten = price(l.id(), null, "80", "10");
    var twenty = price(l.id(), null, "70", "20");
    assertThat(match(l.id(), null, null, false).price().id()).isEqualTo(base.id());
    assertThat(match(l.id(), null, "1", false).price().id()).isEqualTo(zero.id());
    assertThat(match(l.id(), null, "19", false).price().id()).isEqualTo(ten.id());
    assertThat(match(l.id(), null, "20", false).price().id()).isEqualTo(twenty.id());
    var l2 = listing(l.materialId());
    var base2 = price(l2.id(), null, "1", null);
    price(l2.id(), null, "2", "100");
    assertThat(match(l2.id(), null, "1", false).price().id()).isEqualTo(base2.id());
  }

  @Test
  void intervalsIncludeStartExcludeEndAndDoNotInventMatches() {
    var l = listing(material().id());
    var p = price(l.id(), null, "1", null);
    prices.close(p.id(), new PriceService.CloseInput(AT, 0));
    assertThat(prices.resolve(l.id(), request(null, null, false, FROM), 25, null).priceMatch())
        .isEqualTo(PriceService.MatchStatus.MATCHED);
    assertThat(match(l.id(), null, null, false).priceMatch())
        .isEqualTo(PriceService.MatchStatus.NO_MATCH);
    assertThat(
            prices
                .resolve(l.id(), request(null, null, false, FROM.minusSeconds(1)), 25, null)
                .priceMatch())
        .isEqualTo(PriceService.MatchStatus.NO_MATCH);
  }

  @Test
  void deterministicOrderingIsTemporalNotCheapest() {
    var l = listing(material().id());
    var old = price(l.id(), null, "1", null);
    var newer =
        prices.create(
            new PriceService.Input(
                l.id(),
                null,
                source,
                new BigDecimal("999"),
                "USD",
                MeasurementUnit.METER,
                null,
                FROM.plusSeconds(1),
                null,
                FROM,
                List.of()),
            null);
    assertThat(match(l.id(), null, null, false).price().id()).isEqualTo(newer.id());
    var observationWinner =
        prices.create(
            new PriceService.Input(
                l.id(),
                null,
                source,
                new BigDecimal("1000"),
                "USD",
                MeasurementUnit.METER,
                null,
                FROM.plusSeconds(1),
                null,
                FROM.plusSeconds(1),
                List.of()),
            null);
    assertThat(match(l.id(), null, null, false).price().id()).isEqualTo(observationWinner.id());
  }

  @Test
  void currentListingTermsDoNotChangeHistoricalMatchAndUnknownMoqNeverHidesPrice() {
    var m = material();
    var l = listing(m.id());
    var p = price(l.id(), null, "1", "10");
    var current = prices.resolve(l.id(), request(null, "20", false, null), 25, null);
    assertThat(current.scopes().getFirst().commercialEligibility())
        .isEqualTo(PriceService.Eligibility.UNKNOWN_TERMS);
    assertThat(current.scopes().getFirst().price().id()).isEqualTo(p.id());
    var updated =
        listings.update(
            l.id(),
            listingInput(
                m.id(),
                new BigDecimal("100"),
                new BigDecimal("999"),
                MeasurementUnit.METER,
                ListingService.Status.ACTIVE,
                0));
    assertThat(match(l.id(), null, "20", false).price().id()).isEqualTo(p.id());
    assertThat(
            prices
                .resolve(l.id(), request(null, "20", false, null), 25, null)
                .scopes()
                .getFirst()
                .commercialEligibility())
        .isEqualTo(PriceService.Eligibility.INELIGIBLE);
    listings.update(
        l.id(),
        listingInput(m.id(), null, null, null, ListingService.Status.ARCHIVED, updated.version()));
    var historical = prices.resolve(l.id(), request(null, "20", false, AT), 25, null);
    assertThat(historical.scopes().getFirst().price().id()).isEqualTo(p.id());
    assertThat(historical.listingTermsScope())
        .isEqualTo(PriceService.TermsScope.HISTORICAL_TERMS_NOT_RECONSTRUCTED);
    assertThat(historical.scopes().getFirst().commercialEligibility())
        .isEqualTo(PriceService.Eligibility.NOT_EVALUATED_FOR_HISTORICAL_QUERY);
  }

  @Test
  void mcqIsNeverComparedToGenericQuantity() {
    var m = material();
    var l =
        listings.create(
            listingInput(
                m.id(),
                BigDecimal.ONE,
                new BigDecimal("9999"),
                MeasurementUnit.METER,
                ListingService.Status.ACTIVE,
                0));
    price(l.id(), null, "1", null);
    var result = prices.resolve(l.id(), request(null, "2", false, null), 25, null);
    assertThat(result.scopes().getFirst().commercialEligibility())
        .isEqualTo(PriceService.Eligibility.ELIGIBLE);
    assertThat(result.currentListingTerms().minimumColorQuantity()).isEqualByComparingTo("9999");
  }

  @Test
  void providerCurrencyUnitGroupsAndScopeCursorAreIndependent() {
    var l = listing(material().id());
    price(l.id(), null, "1", null);
    prices.create(input(l.id(), null, "2", null, "JPY", MeasurementUnit.METER), null);
    prices.create(input(l.id(), null, "3", null, "USD", MeasurementUnit.YARD), null);
    var r = request(null, null, false, null);
    var first = prices.resolve(l.id(), r, 1, null);
    var second = prices.resolve(l.id(), r, 1, first.nextCursor());
    assertThat(second.asOf()).isEqualTo(first.asOf());
    assertThat(second.scopes().getFirst()).isNotEqualTo(first.scopes().getFirst());
    assertThat(prices.resolve(l.id(), r, 25, null).scopes()).hasSize(3);
    assertThatThrownBy(
            () -> prices.resolve(l.id(), request(null, "1", false, null), 1, first.nextCursor()))
        .isInstanceOf(RuntimeException.class);
    var history = prices.history(new PriceService.HistoryFilter(l.id(), null, null, null), 1, null);
    assertThat(
            prices
                .history(
                    new PriceService.HistoryFilter(l.id(), null, null, null),
                    1,
                    history.nextCursor())
                .items()
                .getFirst()
                .id())
        .isNotEqualTo(history.items().getFirst().id());
    assertThatThrownBy(
            () ->
                prices.history(new PriceService.HistoryFilter(l.id(), null, null, null), 101, null))
        .isInstanceOf(RuntimeException.class);
  }

  @Test
  void priceAuditFailureRollsBackInsertionAndEvidence() {
    var l = listing(material().id());
    UUID command = UUID.randomUUID();
    jdbc.sql(
            "CREATE FUNCTION reject_test_price_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
                + " IF NEW.action='material.price.created' THEN RAISE EXCEPTION 'Synthetic audit"
                + " failure'; END IF; RETURN NEW; END; $$")
        .update();
    jdbc.sql(
            "CREATE TRIGGER reject_test_price_audit BEFORE INSERT ON audit_event FOR EACH ROW"
                + " EXECUTE FUNCTION reject_test_price_audit()")
        .update();
    try {
      assertThatThrownBy(
              () ->
                  prices.create(
                      input(l.id(), null, "1", null, "USD", MeasurementUnit.METER), command))
          .isInstanceOf(RuntimeException.class);
      assertThat(
              jdbc.sql("SELECT count(*) FROM material_price WHERE id=:id")
                  .param("id", command)
                  .query(Long.class)
                  .single())
          .isZero();
    } finally {
      jdbc.sql("DROP TRIGGER reject_test_price_audit ON audit_event").update();
      jdbc.sql("DROP FUNCTION reject_test_price_audit()").update();
    }
  }
}
