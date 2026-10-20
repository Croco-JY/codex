package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.dataingestion.SourceService;
import com.sourceos.materialprice.PriceService;
import com.sourceos.shared.MeasurementUnit;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class MaterialPriceProvenanceTest extends CatalogIntegrationSupport {
  @Autowired PriceService prices;
  static final Instant FROM = Instant.parse("2025-01-01T00:00:00Z"),
      TO = Instant.parse("2026-01-01T00:00:00Z");

  PriceService.Input input(UUID listing, List<UUID> evidence) {
    return input(listing, "10", evidence);
  }

  PriceService.Input input(UUID listing, String amount, List<UUID> evidence) {
    return new PriceService.Input(
        listing,
        null,
        source,
        new BigDecimal(amount),
        "USD",
        MeasurementUnit.METER,
        null,
        FROM,
        null,
        FROM,
        evidence);
  }

  String json(Object value) {
    return new tools.jackson.databind.ObjectMapper().writeValueAsString(value);
  }

  List<Long> facts(UUID price) {
    return List.of(
        jdbc.sql("SELECT count(*) FROM material_price WHERE id=:id")
            .param("id", price)
            .query(Long.class)
            .single(),
        jdbc.sql("SELECT count(*) FROM material_price_source WHERE material_price_id=:id")
            .param("id", price)
            .query(Long.class)
            .single(),
        jdbc.sql("SELECT count(*) FROM audit_event WHERE entity_id=:id")
            .param("id", price)
            .query(Long.class)
            .single());
  }

  List<Long> totals() {
    return List.of(
        jdbc.sql("SELECT count(*) FROM material_price").query(Long.class).single(),
        jdbc.sql("SELECT count(*) FROM material_price_source").query(Long.class).single(),
        jdbc.sql("SELECT count(*) FROM audit_event").query(Long.class).single());
  }

  long created(UUID price) {
    return jdbc.sql(
            "SELECT count(*) FROM audit_event WHERE entity_id=:id AND"
                + " action='material.price.created'")
        .param("id", price)
        .query(Long.class)
        .single();
  }

  UUID differentProviderObservation() {
    UUID provider =
        sources.source(
            null,
            new SourceService.SourceInput(
                "provenance-" + id(),
                SourceService.SourceType.MANUAL_ENTRY,
                "Synthetic other price provider",
                null,
                null,
                SourceService.AccessMethod.MANUAL,
                SourceService.Normalization.PRESERVE,
                true,
                0));
    return observation(
        sources
            .record(
                new SourceService.RecordInput(
                    provider, SourceService.RecordKind.SUPPLIER, "other-price-evidence"))
            .id());
  }

  void auditGuard(String action) {
    jdbc.sql(
            "CREATE FUNCTION reject_test_provenance_audit() RETURNS trigger LANGUAGE plpgsql AS $$"
                + " BEGIN IF NEW.action='"
                + action
                + "' THEN RAISE EXCEPTION 'Synthetic provenance audit failure'; END IF; RETURN NEW;"
                + " END; $$")
        .update();
    jdbc.sql(
            "CREATE TRIGGER reject_test_provenance_audit BEFORE INSERT ON audit_event FOR EACH ROW"
                + " EXECUTE FUNCTION reject_test_provenance_audit()")
        .update();
  }

  void removeAuditGuard() {
    jdbc.sql("DROP TRIGGER reject_test_provenance_audit ON audit_event").update();
    jdbc.sql("DROP FUNCTION reject_test_provenance_audit()").update();
  }

  @Test
  void manualEmptyObservationListIsRejectedWithoutPriceEvidenceOrAudit() throws Exception {
    var l = listing(material().id());
    UUID key = id();
    var before = totals();
    mvc.perform(
            post("/api/v1/admin/material-prices")
                .header("X-Dev-Subject", principal)
                .header("Idempotency-Key", key)
                .contentType("application/json")
                .content(json(input(l.id(), List.of()))))
        .andExpect(status().isBadRequest());
    assertThat(facts(key)).containsExactly(0L, 0L, 0L);
    assertThat(totals()).isEqualTo(before);
  }

  @Test
  void manualNullObservationListIsRejectedWithoutPriceEvidenceOrAudit() throws Exception {
    var l = listing(material().id());
    UUID key = id();
    var before = totals();
    mvc.perform(
            post("/api/v1/admin/material-prices")
                .header("X-Dev-Subject", principal)
                .header("Idempotency-Key", key)
                .contentType("application/json")
                .content(json(input(l.id(), null))))
        .andExpect(status().isBadRequest());
    assertThat(facts(key)).containsExactly(0L, 0L, 0L);
    assertThat(totals()).isEqualTo(before);
  }

  @Test
  void manualOneSameProviderObservationCommitsPriceSourceAndAudit() throws Exception {
    var l = listing(material().id());
    UUID key = id();
    mvc.perform(
            post("/api/v1/admin/material-prices")
                .header("X-Dev-Subject", principal)
                .header("Idempotency-Key", key)
                .contentType("application/json")
                .content(json(input(l.id(), List.of(observation)))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(key.toString()));
    assertThat(facts(key)).containsExactly(1L, 1L, 2L);
    assertThat(created(key)).isEqualTo(1);
    assertThat(
            jdbc.sql("SELECT DISTINCT actor_subject FROM audit_event WHERE entity_id=:id")
                .param("id", key)
                .query(String.class)
                .list())
        .containsExactly(principal);
  }

  @Test
  void manualMultipleSameProviderObservationsDeduplicateBeforeCommit() throws Exception {
    var l = listing(material().id());
    UUID second = observation(record), key = id();
    mvc.perform(
            post("/api/v1/admin/material-prices")
                .header("X-Dev-Subject", principal)
                .header("Idempotency-Key", key)
                .contentType("application/json")
                .content(json(input(l.id(), List.of(observation, second, second)))))
        .andExpect(status().isOk());
    assertThat(facts(key)).containsExactly(1L, 2L, 3L);
    assertThat(created(key)).isEqualTo(1);
  }

  @Test
  void crossProviderEvidenceRollsBackEarlierValidEvidenceAndAllAudit() throws Exception {
    var l = listing(material().id());
    UUID wrong = differentProviderObservation(), key = id();
    var before = totals();
    mvc.perform(
            post("/api/v1/admin/material-prices")
                .header("X-Dev-Subject", principal)
                .header("Idempotency-Key", key)
                .contentType("application/json")
                .content(json(input(l.id(), List.of(observation, wrong)))))
        .andExpect(status().isConflict());
    assertThat(facts(key)).containsExactly(0L, 0L, 0L);
    assertThat(totals()).isEqualTo(before);
  }

  @Test
  void retryAddsMissingEvidenceOnceAndPreservesClosedImmutablePrice() {
    var l = listing(material().id());
    UUID key = id(), second = observation(record);
    var original = input(l.id(), List.of(observation));
    prices.create(original, key);
    var closed = prices.close(key, new PriceService.CloseInput(TO, 0));
    var retry = input(l.id(), "10.0000", List.of(observation, second, second));
    assertThat(prices.create(retry, key)).isEqualTo(closed);
    assertThat(facts(key)).containsExactly(1L, 2L, 4L);
    assertThat(created(key)).isEqualTo(1);
    var before = totals();
    assertThat(prices.create(retry, key)).isEqualTo(closed);
    assertThat(totals()).isEqualTo(before);
  }

  @Test
  void retryCrossProviderEvidenceIsRejectedInsteadOfSilentlyDiscarded() throws Exception {
    var l = listing(material().id());
    UUID key = id(), second = observation(record), wrong = differentProviderObservation();
    prices.create(input(l.id(), List.of(observation)), key);
    var before = totals();
    mvc.perform(
            post("/api/v1/admin/material-prices")
                .header("X-Dev-Subject", principal)
                .header("Idempotency-Key", key)
                .contentType("application/json")
                .content(json(input(l.id(), List.of(observation, second, wrong)))))
        .andExpect(status().isConflict());
    assertThat(facts(key)).containsExactly(1L, 1L, 2L);
    assertThat(totals()).isEqualTo(before);
  }

  @Test
  void conflictingRetryFacts409BeforeAnyEvidenceAppend() throws Exception {
    var l = listing(material().id());
    UUID key = id(), second = observation(record);
    prices.create(input(l.id(), List.of(observation)), key);
    var before = totals();
    mvc.perform(
            post("/api/v1/admin/material-prices")
                .header("X-Dev-Subject", principal)
                .header("Idempotency-Key", key)
                .contentType("application/json")
                .content(json(input(l.id(), "11", List.of(second)))))
        .andExpect(status().isConflict());
    assertThat(prices.read(key).amount()).isEqualByComparingTo("10");
    assertThat(facts(key)).containsExactly(1L, 1L, 2L);
    assertThat(totals()).isEqualTo(before);
  }

  @Test
  void evidenceAuditFailureRollsBackRetryAssociation() {
    var l = listing(material().id());
    UUID key = id(), second = observation(record);
    prices.create(input(l.id(), List.of(observation)), key);
    var before = totals();
    auditGuard("material.price.source.added");
    try {
      assertThatThrownBy(() -> prices.create(input(l.id(), List.of(observation, second)), key))
          .hasStackTraceContaining("Synthetic provenance audit failure");
      assertThat(facts(key)).containsExactly(1L, 1L, 2L);
      assertThat(totals()).isEqualTo(before);
    } finally {
      removeAuditGuard();
    }
  }

  @Test
  void creationAuditFailureRollsBackPriceAndAllSupportingFacts() {
    var l = listing(material().id());
    UUID key = id(), second = observation(record);
    var before = totals();
    auditGuard("material.price.created");
    try {
      assertThatThrownBy(() -> prices.create(input(l.id(), List.of(observation, second)), key))
          .hasStackTraceContaining("Synthetic provenance audit failure");
      assertThat(facts(key)).containsExactly(0L, 0L, 0L);
      assertThat(totals()).isEqualTo(before);
    } finally {
      removeAuditGuard();
    }
  }

  @Test
  void importedPriceInjectsMandatoryObservationWithNullOrEmptyNestedEvidence() throws Exception {
    var l = listing(material().id());
    UUID second = observation(record);
    UUID first = null;
    for (List<UUID> supplied : Arrays.<List<UUID>>asList(null, List.of())) {
      String body =
          json(
              new PriceService.ImportInput(
                  observation, "stable-import-line", input(l.id(), supplied)));
      var response =
          mvc.perform(
                  post("/api/v1/admin/material-price-imports")
                      .header("X-Dev-Subject", principal)
                      .contentType("application/json")
                      .content(body))
              .andExpect(status().isOk())
              .andReturn();
      UUID actual =
          UUID.fromString(
              new tools.jackson.databind.ObjectMapper()
                  .readTree(response.getResponse().getContentAsString())
                  .get("id")
                  .asText());
      if (first == null) first = actual;
      else assertThat(actual).isEqualTo(first);
      assertThat(facts(first)).containsExactly(1L, 1L, 2L);
    }
    String body =
        json(
            new PriceService.ImportInput(
                observation, "stable-import-line", input(l.id(), List.of(second))));
    mvc.perform(
            post("/api/v1/admin/material-price-imports")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(first.toString()));
    assertThat(facts(first)).containsExactly(1L, 2L, 3L);
    assertThat(created(first)).isEqualTo(1);
  }

  @Test
  void importedConflictingFactsReturn409WithNoDuplicatePriceOrEvidence() throws Exception {
    var l = listing(material().id());
    var first =
        prices.importPrice(
            new PriceService.ImportInput(observation, "stable-conflict", input(l.id(), null)));
    var before = totals();
    mvc.perform(
            post("/api/v1/admin/material-price-imports")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(
                    json(
                        new PriceService.ImportInput(
                            observation, "stable-conflict", input(l.id(), "11", List.of())))))
        .andExpect(status().isConflict());
    assertThat(facts(first.id())).containsExactly(1L, 1L, 2L);
    assertThat(totals()).isEqualTo(before);
  }

  @Test
  void importedProviderMismatchIsRejectedBeforeAnyMutation() throws Exception {
    var l = listing(material().id());
    UUID wrong = differentProviderObservation();
    var before = totals();
    mvc.perform(
            post("/api/v1/admin/material-price-imports")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(
                    json(
                        new PriceService.ImportInput(
                            wrong, "wrong-provider", input(l.id(), null)))))
        .andExpect(status().isBadRequest());
    assertThat(totals()).isEqualTo(before);
  }
}
