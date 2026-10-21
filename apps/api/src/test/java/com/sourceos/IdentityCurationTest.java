package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.sourceos.dataingestion.SourceService;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/** Existing-contract regression only: no production semantics or migration changes. */
class IdentityCurationTest extends CatalogIntegrationSupport {
  enum Kind {
    SUPPLIER(
        "suppliers", "supplier", "supplier_profile", "supplier_external_record", "supplier_id"),
    FACILITY("facilities", "facility", "facility", "facility_external_record", "facility_id"),
    MATERIAL("materials", "material", "material", "material_external_record", "material_id"),
    MATERIAL_VARIANT(
        "material-variants",
        "variant",
        "material_variant",
        "material_variant_external_record",
        "material_variant_id"),
    MATERIAL_LISTING(
        "material-listings",
        "listing",
        "supplier_material_listing",
        "supplier_material_listing_external_record",
        "listing_id");
    final String path, nested, table, binding, key;

    Kind(String p, String n, String t, String b, String k) {
      path = p;
      nested = n;
      table = t;
      binding = b;
      key = k;
    }

    String resolve() {
      return "/api/v1/admin/"
          + (this == MATERIAL_VARIANT
              ? "material-variant"
              : this == MATERIAL_LISTING ? "material-listing" : nested)
          + "-identities";
    }
  }

  final tools.jackson.databind.ObjectMapper mapper = new tools.jackson.databind.ObjectMapper();

  Map<String, Object> draft(Kind k, UUID obs, String name) {
    var b = new LinkedHashMap<String, Object>();
    b.put("version", 0);
    b.put("observationId", obs);
    b.put("status", "ACTIVE");
    switch (k) {
      case SUPPLIER -> {
        b.put("countryId", JP);
        b.put("displayName", name);
        b.put("roles", List.of("MILL"));
      }
      case FACILITY -> {
        b.put("supplierId", catalogSupplier);
        b.put("countryId", JP);
        b.put("facilityType", "MILL");
        b.put("name", name);
      }
      case MATERIAL -> {
        b.put("catalogSupplierId", catalogSupplier);
        b.put("materialType", "FABRIC");
        b.put("displayName", name);
        b.put("compositionCompleteness", "UNKNOWN");
        b.put("composition", List.of());
      }
      case MATERIAL_VARIANT -> {
        b.put("materialId", material().id());
        b.put("variantName", name);
      }
      case MATERIAL_LISTING -> {
        b.put("materialId", material().id());
        b.put("sellerSupplierId", seller);
        b.put("sellerArticleNumber", name);
      }
    }
    return b;
  }

  String command(String path, Object body, int status) throws Exception {
    var response =
        mvc.perform(
                post(path)
                    .header("X-Dev-Subject", principal)
                    .contentType("application/json")
                    .content(mapper.writeValueAsString(body)))
            .andReturn()
            .getResponse();
    actor(principal);
    assertThat(response.getStatus()).as(path).isEqualTo(status);
    return response.getContentAsString();
  }

  UUID resolve(Kind k, UUID r, Map<String, Object> body) throws Exception {
    return UUID.fromString(
        mapper
            .readTree(command(k.resolve(), Map.of("sourceRecordId", r, k.nested, body), 200))
            .get("id")
            .asText());
  }

  long count(String sql, UUID id) {
    return jdbc.sql(sql).param("id", id).query(Long.class).single();
  }

  String read(Kind k, UUID id) throws Exception {
    var response =
        mvc.perform(get("/api/v1/" + k.path + "/" + id).header("X-Dev-Subject", principal))
            .andReturn()
            .getResponse();
    actor(principal);
    assertThat(response.getStatus()).isEqualTo(200);
    return response.getContentAsString();
  }

  @ParameterizedTest
  @EnumSource(Kind.class)
  void resolveReuseIgnoresDifferentDraftAndVersionButAddsOnlyRecordEvidence(Kind k)
      throws Exception {
    UUID r = external(SourceService.RecordKind.valueOf(k.name()), "resolve-" + id());
    UUID first = observation(r), second = observation(r);
    var input = draft(k, first, "Original canonical");
    UUID target = resolve(k, r, input);
    var before = mapper.readTree(read(k, target));
    // Deliberately different parent/fields/version remain valid create DTOs but are not updates.
    var other = draft(k, second, "Ignored different draft");
    other.put("version", 91);
    if (k == Kind.FACILITY) other.put("supplierId", seller);
    if (k == Kind.MATERIAL) {
      other.put("catalogSupplierId", seller);
      other.put("materialType", "LEATHER");
    }
    assertThat(resolve(k, r, other)).isEqualTo(target);
    assertThat(mapper.readTree(read(k, target))).isEqualTo(before);
    String sourceTable =
        k == Kind.SUPPLIER
            ? "supplier_source"
            : k == Kind.FACILITY
                ? "facility_source"
                : k == Kind.MATERIAL
                    ? "material_source"
                    : k == Kind.MATERIAL_VARIANT
                        ? "material_variant_source"
                        : "supplier_material_listing_source";
    assertThat(
            count(
                "SELECT count(*) FROM "
                    + sourceTable
                    + " WHERE "
                    + k.key
                    + "=:id AND field_name='RECORD'",
                target))
        .isEqualTo(2);
    assertThat(resolve(k, r, other)).isEqualTo(target);
    assertThat(
            count(
                "SELECT count(*) FROM audit_event WHERE entity_id=:id AND action LIKE"
                    + " '%.identity.bound'",
                target))
        .isEqualTo(1);
  }

  @ParameterizedTest
  @EnumSource(Kind.class)
  void standaloneReplayConflictAndAllDestructiveGuards(Kind k) throws Exception {
    UUID r = external(SourceService.RecordKind.valueOf(k.name()), "binding-" + id());
    UUID target = resolve(k, r, draft(k, observation(r), "Bound canonical"));
    String path = "/api/v1/admin/" + k.path + "/" + target + "/external-records";
    command(path, Map.of("sourceRecordId", r), 200);
    assertThat(
            count(
                "SELECT count(*) FROM audit_event WHERE entity_id=:id AND action LIKE"
                    + " '%.identity.bound'",
                target))
        .isEqualTo(1);
    UUID otherRecord = external(SourceService.RecordKind.valueOf(k.name()), "other-" + id());
    UUID other = resolve(k, otherRecord, draft(k, observation(otherRecord), "Other canonical"));
    command(
        "/api/v1/admin/" + k.path + "/" + other + "/external-records",
        Map.of("sourceRecordId", r),
        409);
    for (String sql :
        List.of(
            "UPDATE " + k.binding + " SET created_at=created_at WHERE source_record_id=:id",
            "DELETE FROM " + k.binding + " WHERE source_record_id=:id",
            "TRUNCATE " + k.binding)) {
      assertThatThrownBy(() -> jdbc.sql(sql).param("id", r).update())
          .hasMessageContaining("append-only");
    }
    assertThat(count("SELECT count(*) FROM " + k.binding + " WHERE source_record_id=:id", r))
        .isEqualTo(1);
  }

  @ParameterizedTest
  @EnumSource(Kind.class)
  void allKindsRejectMissingWrongRecordAndUnrelatedObservation(Kind k) throws Exception {
    var input = draft(k, observation, "Invalid identity");
    command(k.resolve(), Map.of("sourceRecordId", id(), k.nested, input), 400);
    for (var wrong : SourceService.RecordKind.values())
      if (!wrong.name().equals(k.name())) {
        UUID r = external(wrong, "wrong-" + id());
        command(k.resolve(), Map.of("sourceRecordId", r, k.nested, input), 400);
      }
    UUID r = external(SourceService.RecordKind.valueOf(k.name()), "mismatch-" + id());
    command(k.resolve(), Map.of("sourceRecordId", r, k.nested, input), 400);
    input.put("observationId", id());
    command(k.resolve(), Map.of("sourceRecordId", r, k.nested, input), 400);
    assertThat(count("SELECT count(*) FROM " + k.binding + " WHERE source_record_id=:id", r))
        .isZero();
  }

  @ParameterizedTest
  @EnumSource(Kind.class)
  void independentConcurrentDifferentDraftsResolveOneCanonical(Kind k) throws Exception {
    UUID r = external(SourceService.RecordKind.valueOf(k.name()), "race-" + id()),
        obs = observation(r);
    var a = draft(k, obs, "First competing draft");
    var b = draft(k, obs, "Second competing draft");
    long before = jdbc.sql("SELECT count(*) FROM " + k.table).query(Long.class).single();
    var start = new CountDownLatch(1);
    try (var pool = Executors.newFixedThreadPool(2)) {
      List<Future<UUID>> results = new ArrayList<>();
      for (var input : List.of(a, b))
        results.add(
            pool.submit(
                () -> {
                  start.await();
                  return resolve(k, r, input);
                }));
      start.countDown();
      UUID winner = results.get(0).get(20, TimeUnit.SECONDS);
      assertThat(results.get(1).get(20, TimeUnit.SECONDS)).isEqualTo(winner);
      assertThat(jdbc.sql("SELECT count(*) FROM " + k.table).query(Long.class).single())
          .isEqualTo(before + 1);
      assertThat(count("SELECT count(*) FROM " + k.binding + " WHERE source_record_id=:id", r))
          .isEqualTo(1);
      assertThat(
              count(
                  "SELECT count(*) FROM audit_event WHERE entity_id=:id AND action LIKE"
                      + " '%.identity.bound'",
                  winner))
          .isEqualTo(1);
    }
  }

  @ParameterizedTest
  @EnumSource(Kind.class)
  void standaloneTargetFirstAndTypedMissingRecordErrors(Kind k) throws Exception {
    UUID own = external(SourceService.RecordKind.valueOf(k.name()), "target-" + id());
    UUID target = resolve(k, own, draft(k, observation(own), "Typed binding target"));
    String path = "/api/v1/admin/" + k.path + "/" + target + "/external-records";
    command(path, Map.of("sourceRecordId", id()), 400);
    command(
        "/api/v1/admin/" + k.path + "/" + id() + "/external-records",
        Map.of("sourceRecordId", id()),
        404);
    for (var wrong : SourceService.RecordKind.values())
      if (!wrong.name().equals(k.name())) {
        UUID r = external(wrong, "wrong-binding-" + id());
        command(path, Map.of("sourceRecordId", r), 400);
        assertThat(count("SELECT count(*) FROM " + k.binding + " WHERE source_record_id=:id", r))
            .isZero();
      }
  }

  @Test
  void competingStandaloneBindingsCannotReassign() throws Exception {
    var a = supplier(JP, "First binding target");
    var b = supplier(JP, "Second binding target");
    UUID r = external(SourceService.RecordKind.SUPPLIER, "bind-race-" + id());
    var start = new CountDownLatch(1);
    try (var pool = Executors.newFixedThreadPool(2)) {
      List<Future<Integer>> results = new ArrayList<>();
      for (var target : List.of(a.id(), b.id()))
        results.add(
            pool.submit(
                () -> {
                  start.await();
                  return mvc.perform(
                          post("/api/v1/admin/suppliers/" + target + "/external-records")
                              .header("X-Dev-Subject", principal)
                              .contentType("application/json")
                              .content(mapper.writeValueAsString(Map.of("sourceRecordId", r))))
                      .andReturn()
                      .getResponse()
                      .getStatus();
                }));
      start.countDown();
      assertThat(
              List.of(
                  results.get(0).get(20, TimeUnit.SECONDS),
                  results.get(1).get(20, TimeUnit.SECONDS)))
          .containsExactlyInAnyOrder(200, 409);
      UUID winner =
          jdbc.sql("SELECT supplier_id FROM supplier_external_record WHERE source_record_id=:id")
              .param("id", r)
              .query(UUID.class)
              .single();
      assertThat(
              count(
                  "SELECT count(*) FROM audit_event WHERE entity_id=:id AND"
                      + " action='supplier.identity.bound'",
                  winner))
          .isEqualTo(1);
      UUID loser = winner.equals(a.id()) ? b.id() : a.id();
      assertThat(
              count(
                  "SELECT count(*) FROM audit_event WHERE entity_id=:id AND"
                      + " action='supplier.identity.bound'",
                  loser))
          .isZero();
    }
  }
}
