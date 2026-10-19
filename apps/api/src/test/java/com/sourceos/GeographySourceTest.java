package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.dataingestion.SourceService;
import com.sourceos.geography.GeographyService;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.context.SecurityContextHolder;

class GeographySourceTest extends SupplyIntegrationSupport {
  @Autowired GeographyService geography;
  @Autowired SourceService sources;
  static final UUID JP = UUID.fromString("00000000-0000-4000-8000-000000000002"),
      CN = UUID.fromString("00000000-0000-4000-8000-000000000003");
  String principal;

  @BeforeEach
  void setup() {
    principal = admin();
    actor(principal);
  }

  @AfterEach
  void clear() {
    SecurityContextHolder.clearContext();
  }

  UUID region(UUID parent, UUID country) {
    return geography.region(
        null,
        new GeographyService.RegionInput(
            country,
            parent,
            null,
            "Synthetic region",
            null,
            GeographyService.RegionType.PREFECTURE,
            true,
            0));
  }

  UUID source(SourceService.Normalization policy) {
    return sources.source(
        null,
        new SourceService.SourceInput(
            "test-" + id(),
            SourceService.SourceType.MANUAL_ENTRY,
            "Synthetic dataset",
            null,
            null,
            SourceService.AccessMethod.MANUAL,
            policy,
            true,
            0));
  }

  SourceService.RecordView record(UUID source, SourceService.RecordKind kind, String key) {
    return sources.record(new SourceService.RecordInput(source, kind, key));
  }

  SourceService.ObservationInput observation(UUID record, String key, Instant at, UUID supersedes) {
    return new SourceService.ObservationInput(
        record, key, at, null, "a".repeat(64), "SHA-256", supersedes);
  }

  @Test
  void stableReferenceSeeds() {
    assertThat(geography.countries())
        .extracting(GeographyService.Country::alpha2)
        .containsExactly("CN", "JP", "KR");
  }

  @Test
  void regionsRejectSelfAndIndirectCycle() {
    UUID a = region(null, JP), b = region(a, JP);
    assertThatThrownBy(
            () ->
                jdbc.sql("UPDATE region SET parent_region_id=id WHERE id=:id")
                    .param("id", a)
                    .update())
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                jdbc.sql("UPDATE region SET parent_region_id=:b WHERE id=:a")
                    .param("b", b)
                    .param("a", a)
                    .update())
        .hasMessageContaining("cycle");
  }

  @Test
  void parentMustShareCountry() {
    UUID p = region(null, CN);
    assertThatThrownBy(() -> region(p, JP))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }

  @Test
  void clusterMustShareCountry() {
    UUID p = region(null, CN);
    assertThatThrownBy(
            () ->
                geography.cluster(
                    null,
                    new GeographyService.ClusterInput(
                        JP, p, "test-cluster", "Synthetic cluster", null, null, true, 0)))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }

  @Test
  void keyIdentityIsStructuredAndPreservesRaw() {
    UUID source = source(SourceService.Normalization.PRESERVE);
    var supplier = record(source, SourceService.RecordKind.SUPPLIER, "AbC 123");
    var material = record(source, SourceService.RecordKind.MATERIAL, "AbC 123");
    assertThat(supplier.id()).isNotEqualTo(material.id());
    assertThat(supplier.externalRecordKey()).isEqualTo("AbC 123");
    assertThat(record(source, SourceService.RecordKind.SUPPLIER, "AbC 123").id())
        .isEqualTo(supplier.id());
    assertThat(record(source, SourceService.RecordKind.SUPPLIER, "abc 123").id())
        .isNotEqualTo(supplier.id());
  }

  @Test
  void normalizationIsPerSource() {
    UUID source = source(SourceService.Normalization.TRIM);
    var first = record(source, SourceService.RecordKind.SUPPLIER, " XyZ ");
    var retry = record(source, SourceService.RecordKind.SUPPLIER, "XyZ");
    assertThat(first.id()).isEqualTo(retry.id());
    assertThat(retry.externalRecordKey()).isEqualTo(" XyZ ");
    assertThat(retry.normalizedExternalRecordKey()).isEqualTo("XyZ");
    assertThatThrownBy(
            () ->
                jdbc.sql("UPDATE data_source SET normalization_policy='PRESERVE' WHERE id=:id")
                    .param("id", source)
                    .update())
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }

  @Test
  void databaseRejectsWrongNormalization() {
    UUID source = source(SourceService.Normalization.PRESERVE);
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        "INSERT INTO"
                            + " data_source_record(id,data_source_id,record_kind,external_record_key,normalized_external_record_key)"
                            + " VALUES(:id,:source,'SUPPLIER','CaseSensitive','casesensitive')")
                    .param("id", id())
                    .param("source", source)
                    .update())
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }

  @Test
  void observationRetryAndConflictingRetry() {
    var rec =
        record(
            source(SourceService.Normalization.PRESERVE),
            SourceService.RecordKind.SUPPLIER,
            "observation");
    Instant at = Instant.parse("2026-10-01T12:00:00Z");
    var input = observation(rec.id(), "observation-1", at, null);
    var first = sources.observe(input);
    assertThat(sources.observe(input).id()).isEqualTo(first.id());
    assertThatThrownBy(
            () -> sources.observe(observation(rec.id(), "observation-1", at.plusSeconds(1), null)))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    var corrected =
        sources.observe(observation(rec.id(), "observation-2", at.plusSeconds(100), first.id()));
    assertThat(corrected.supersedesObservationId()).isEqualTo(first.id());
    var row =
        jdbc.sql("SELECT first_seen_at,last_seen_at FROM data_source_record WHERE id=:id")
            .param("id", rec.id())
            .query()
            .singleRow();
    assertThat(row.get("first_seen_at").toString()).contains("2026-10-01");
  }

  @Test
  void supersedesCannotCrossRecord() {
    var a =
        record(
            source(SourceService.Normalization.PRESERVE), SourceService.RecordKind.SUPPLIER, "a");
    var b =
        record(
            source(SourceService.Normalization.PRESERVE), SourceService.RecordKind.SUPPLIER, "b");
    var prior =
        sources.observe(observation(a.id(), "first", Instant.parse("2026-10-01T00:00:00Z"), null));
    assertThatThrownBy(
            () ->
                sources.observe(
                    observation(b.id(), "bad", Instant.parse("2026-10-02T00:00:00Z"), prior.id())))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }

  @Test
  void factsAndReviewsAreSeparateAppendOnly() {
    var rec =
        record(
            source(SourceService.Normalization.PRESERVE),
            SourceService.RecordKind.SUPPLIER,
            "review");
    var obs =
        sources.observe(
            observation(rec.id(), "first", Instant.parse("2026-10-01T00:00:00Z"), null));
    sources.review(
        obs.id(),
        new SourceService.ReviewInput(
            SourceService.ReviewStatus.NEEDS_REVIEW, null, null, "Awaiting evidence"));
    sources.review(
        obs.id(),
        new SourceService.ReviewInput(
            SourceService.ReviewStatus.ACCEPTED,
            SourceService.PermissionStatus.PERMITTED,
            null,
            null));
    var reviews = sources.reviews(obs.id());
    assertThat(reviews).hasSize(2);
    assertThat(reviews.getFirst().reviewStatus()).isEqualTo(SourceService.ReviewStatus.ACCEPTED);
    assertThat(reviews.getFirst().reviewedBySubject()).isEqualTo(principal);
    for (String table : List.of("data_source_observation", "data_source_observation_review"))
      for (String sql :
          List.of(
              "UPDATE " + table + " SET id=id",
              "DELETE FROM " + table,
              "TRUNCATE " + table + " CASCADE"))
        assertThatThrownBy(() -> jdbc.sql(sql).update()).hasMessageContaining("append-only");
  }

  @Test
  void concurrentExternalIdentityResolvesOnce() throws Exception {
    UUID source = source(SourceService.Normalization.PRESERVE);
    try (var pool = Executors.newFixedThreadPool(2)) {
      Callable<UUID> action =
          () -> {
            actor(principal);
            try {
              return record(source, SourceService.RecordKind.SUPPLIER, "concurrent").id();
            } finally {
              SecurityContextHolder.clearContext();
            }
          };
      var results = pool.invokeAll(List.of(action, action));
      assertThat(results.get(0).get()).isEqualTo(results.get(1).get());
    }
  }

  @Test
  void APIsEnforceAuthorizationAndRejectRawPayload() throws Exception {
    mvc.perform(get("/api/v1/countries")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/regions").header("X-Dev-Subject", "reader"))
        .andExpect(status().isOk());
    mvc.perform(
            post("/api/v1/admin/regions")
                .header("X-Dev-Subject", "reader")
                .contentType("application/json")
                .content(
                    "{\"countryId\":\""
                        + JP
                        + "\",\"nameEn\":\"Synthetic\",\"regionType\":\"CITY\",\"active\":true,\"version\":0}"))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/v1/admin/source-observations")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(
                    "{\"sourceRecordId\":\""
                        + id()
                        + "\",\"observationKey\":\"x\",\"observedAt\":\"2026-10-01T00:00:00Z\",\"raw_payload\":{\"secret\":\"not-for-storage\"}}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void concurrentReparentingCannotIntroduceCycle() throws Exception {
    UUID a = region(null, JP), b = region(null, JP);
    try (var pool = Executors.newFixedThreadPool(2)) {
      var ready = new java.util.concurrent.CountDownLatch(2);
      var start = new java.util.concurrent.CountDownLatch(1);
      java.util.concurrent.Callable<Boolean> first =
          () -> {
            ready.countDown();
            start.await();
            try {
              jdbc.sql("UPDATE region SET parent_region_id=:parent WHERE id=:id")
                  .param("parent", b)
                  .param("id", a)
                  .update();
              return true;
            } catch (org.springframework.dao.DataIntegrityViolationException expected) {
              return false;
            }
          };
      java.util.concurrent.Callable<Boolean> second =
          () -> {
            ready.countDown();
            start.await();
            try {
              jdbc.sql("UPDATE region SET parent_region_id=:parent WHERE id=:id")
                  .param("parent", a)
                  .param("id", b)
                  .update();
              return true;
            } catch (org.springframework.dao.DataIntegrityViolationException expected) {
              return false;
            }
          };
      var x = pool.submit(first);
      var y = pool.submit(second);
      assertThat(ready.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
      start.countDown();
      assertThat(
              java.util.List.of(
                  x.get(10, java.util.concurrent.TimeUnit.SECONDS),
                  y.get(10, java.util.concurrent.TimeUnit.SECONDS)))
          .containsExactlyInAnyOrder(true, false);
    }
  }
}
