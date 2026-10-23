package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.project.ProjectService;
import com.sourceos.style.StyleService;
import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;

class StyleRequirementTest extends StyleRequirementSupport {
  @Test
  void absenceCreateUpdateEmptyAndVersionsAreIndependent() throws Exception {
    problem(request("GET", path(), owner, null), 404);
    problem(put(body(0), owner), 404);
    var b = body(0);
    b.put("productType", "  Garment  ");
    b.put("notes", "  private planning note  ");
    var first = data(put(b, owner, "*"), 201);
    assertThat(first.get("styleId").asText()).isEqualTo(style.id().toString());
    assertThat(first.get("productType").asText()).isEqualTo("Garment");
    assertThat(first.get("notes").asText()).isEqualTo("private planning note");
    assertThat(first.get("version").asLong()).isZero();
    problem(put(body(0), owner, "*"), 412);
    var empty = data(put(body(0), owner), 200);
    for (String k :
        List.of(
            "productType",
            "targetQuantity",
            "quantityUnit",
            "targetCost",
            "currency",
            "targetDeliveryDate",
            "notes")) assertThat(empty.get(k).isNull()).as(k).isTrue();
    assertThat(empty.get("version").asLong()).isEqualTo(1);
    data(request("GET", path(), owner, null), 200);
    problem(put(body(0), owner), 409);
    problem(put(body(0), owner, "*"), 412);
    data(put(body(1), owner), 200).get("version").asLong();
    actor(owner);
    assertThat(requirements.read(org, project.id(), style.id()).version()).isEqualTo(2);
    assertThat(projects.read(org, project.id()).version()).isZero();
    assertThat(styles.read(org, project.id(), style.id()).version()).isZero();
    projects.update(
        org,
        project.id(),
        new ProjectService.UpdateInput(
            project.name(), project.description(), ProjectService.Status.ACTIVE, 0L),
        "meta");
    styles.update(
        org,
        project.id(),
        style.id(),
        new StyleService.UpdateInput(
            style.styleCode(), style.name(), style.description(), StyleService.Status.ACTIVE, 0L),
        "meta");
    assertThat(requirements.read(org, project.id(), style.id()).version()).isEqualTo(2);
    assertThat(requirementAudits()).isEqualTo(3);
    problem(request("POST", path(), owner, body(0)), 405);
    problem(request("DELETE", path(), owner, null), 405);
  }

  static Stream<Arguments> decimalCases() {
    return Stream.of("targetQuantity", "targetCost")
        .flatMap(
            f ->
                Stream.of("0", "0.0000", "0.0001", "999999999999999.9999")
                    .map(v -> Arguments.of(f, v)));
  }

  @ParameterizedTest
  @MethodSource("decimalCases")
  void exactDecimalBoundaries(String field, String value) throws Exception {
    var b = body(0);
    b.put(field, value);
    b.put("quantityUnit", "PCS");
    if (field.equals("targetCost")) b.put("currency", "USD");
    var v = data(put(b, owner, "*"), 201).get(field);
    assertThat(v.isString()).isTrue();
    assertThat(new BigDecimal(v.asText())).isEqualByComparingTo(new BigDecimal(value));
  }

  static Stream<Arguments> badDecimals() {
    return Stream.of("targetQuantity", "targetCost")
        .flatMap(
            f ->
                Stream.of(
                        "-0.0001",
                        "1000000000000000",
                        "1.00001",
                        "1e3",
                        "1E+3",
                        "",
                        "invalid",
                        ".5",
                        12)
                    .map(v -> Arguments.of(f, v)));
  }

  @ParameterizedTest
  @MethodSource("badDecimals")
  void rejectsDecimalLossOrCoercion(String field, Object value) throws Exception {
    var b = body(0);
    b.put(field, value);
    b.put("quantityUnit", "PCS");
    if (field.equals("targetCost")) b.put("currency", "USD");
    problem(put(b, owner, "*"), 400);
    assertThat(requirementAudits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"KRW", "USD", "JPY", "EUR"})
  void commercialCurrencies(String currency) throws Exception {
    var b = body(0);
    b.put("targetCost", "0");
    b.put("currency", currency);
    b.put("quantityUnit", "SET");
    data(put(b, owner, "*"), 201);
  }

  @ParameterizedTest
  @ValueSource(strings = {"usd", "US", "USDD", "XXX", "XTS", "ZZZ"})
  void rejectsCurrencies(String currency) throws Exception {
    var b = body(0);
    b.put("targetCost", "1");
    b.put("currency", currency);
    b.put("quantityUnit", "PCS");
    problem(put(b, owner, "*"), 400);
  }

  @Test
  void pairRulesAndNarrowUnitAndSafeText() throws Exception {
    for (var facts :
        List.of(
            Map.of("targetQuantity", "0"),
            Map.of("targetCost", "1", "currency", "USD"),
            Map.of("targetCost", "1", "quantityUnit", "PCS"),
            Map.of("currency", "USD"))) {
      var b = body(0);
      b.putAll(facts);
      problem(put(b, owner, "*"), 400);
    }
    for (Object u : List.of("KG", "METER", "", 0)) {
      var b = body(0);
      b.put("quantityUnit", u);
      problem(put(b, owner, "*"), 400);
    }
    for (var facts :
        List.of(
            Map.of("notes", "password: synthetic-value"),
            Map.of("productType", "x".repeat(161)),
            Map.of("notes", "x".repeat(4001)))) {
      var b = body(0);
      b.putAll(facts);
      problem(put(b, owner, "*"), 400);
    }
    var b = body(0);
    b.put("quantityUnit", "SET");
    data(put(b, owner, "*"), 201);
    b = body(0);
    b.put("targetQuantity", "0");
    b.put("quantityUnit", "PCS");
    data(put(b, owner), 200);
    b = body(1);
    b.put("targetQuantity", "0.0001");
    b.put("targetCost", "0");
    b.put("currency", "JPY");
    b.put("quantityUnit", "PCS");
    data(put(b, owner), 200);
  }

  @ParameterizedTest
  @ValueSource(strings = {"1990-01-01", "2026-10-23", "2099-12-31", "2024-02-29"})
  void localDateAllowsPastAndLeapDay(String date) throws Exception {
    var b = body(0);
    b.put("targetDeliveryDate", date);
    assertThat(data(put(b, owner, "*"), 201).get("targetDeliveryDate").asText()).isEqualTo(date);
  }

  @ParameterizedTest
  @ValueSource(strings = {"2026-02-30", "2026/10/23", "2026-10-23T00:00:00Z", "", "2026-2-03"})
  void rejectsMalformedDates(String date) throws Exception {
    var b = body(0);
    b.put("targetDeliveryDate", date);
    problem(put(b, owner, "*"), 400);
  }

  @ParameterizedTest
  @ValueSource(strings = {"", " ", "0", "W/\"*\"", "*,*", "\"*\"", "unsupported"})
  void rejectsPreconditions(String header) throws Exception {
    problem(put(body(0), owner, header), 400);
    assertThat(requirementAudits()).isZero();
  }

  @Test
  void duplicateHeadersAndNonzeroCreateAre400() throws Exception {
    problem(put(body(0), owner, "*", "*"), 400);
    problem(put(body(1), owner, "*"), 400);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"missing", "null", "string", "fraction", "negative", "unsafe", "overflow"})
  void versionIsExplicitSafeInteger(String mode) throws Exception {
    var b = new LinkedHashMap<String, Object>();
    switch (mode) {
      case "missing" -> {}
      case "null" -> b.put("version", null);
      case "string" -> b.put("version", "0");
      case "fraction" -> b.put("version", new BigDecimal("0.5"));
      case "negative" -> b.put("version", -1);
      case "unsafe" -> b.put("version", 9007199254740992L);
      case "overflow" -> b.put("version", new java.math.BigInteger("9223372036854775808"));
    }
    problem(put(b, owner, "*"), 400);
    assertThat(requirementAudits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "styleId",
        "projectId",
        "organizationId",
        "actor",
        "createdAt",
        "updatedAt",
        "status",
        "requirementId"
      })
  void unknownOwnershipFieldsRejected(String key) throws Exception {
    var b = body(0);
    b.put(key, id().toString());
    problem(put(b, owner, "*"), 400);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"ORG_OWNER", "ORG_ADMIN", "VIEWER", "OUTSIDER", "REVOKED", "PLATFORM_ADMIN"})
  void organizationAuthority(String role) throws Exception {
    create();
    String subject =
        role.equals("ORG_OWNER")
            ? owner
            : role.equals("PLATFORM_ADMIN") ? admin() : "requirement-" + id();
    if (Set.of("ORG_ADMIN", "VIEWER", "REVOKED").contains(role))
      membership(
          org,
          subject,
          role.equals("REVOKED") ? "ORG_ADMIN" : role,
          role.equals("REVOKED") ? "REVOKED" : "ACTIVE");
    boolean read = Set.of("ORG_OWNER", "ORG_ADMIN", "VIEWER").contains(role),
        write = Set.of("ORG_OWNER", "ORG_ADMIN").contains(role);
    request("GET", path(), subject, null).andExpect(status().is(read ? 200 : 403));
    put(body(0), subject).andExpect(status().is(write ? 200 : 403));
    assertThat(requirementAudits()).isEqualTo(write ? 2 : 1);
  }

  @Test
  void fullHierarchyPrecedesAbsenceAndLifecycle() throws Exception {
    var wrong = path().replace(project.id().toString(), foreignProject.id().toString());
    problem(request("GET", wrong, owner, null), 404);
    problem(request("PUT", wrong, owner, body(0)), 404);
    var wrongStyle = path().replace(style.id().toString(), foreignStyle.id().toString());
    problem(request("GET", wrongStyle, owner, null), 404);
    problem(request("GET", path(), foreignOwner, null), 403);
    request("GET", path(), null, null).andExpect(status().isUnauthorized());
    actor(owner);
    projects.update(
        org,
        project.id(),
        new ProjectService.UpdateInput(
            project.name(), project.description(), ProjectService.Status.ARCHIVED, 0L),
        "archive");
    problem(request("PUT", wrongStyle, owner, body(0)), 404);
    problem(put(body(0), owner, "*"), 409);
    problem(put(body(0), owner), 409);
    assertThat(requirementAudits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void archivedParentsReadableAndOverrideCreatePrecondition(boolean parentProject)
      throws Exception {
    create();
    if (parentProject)
      projects.update(
          org,
          project.id(),
          new ProjectService.UpdateInput(
              project.name(), project.description(), ProjectService.Status.ARCHIVED, 0L),
          "archive");
    else
      styles.update(
          org,
          project.id(),
          style.id(),
          new StyleService.UpdateInput(
              style.styleCode(),
              style.name(),
              style.description(),
              StyleService.Status.ARCHIVED,
              0L),
          "archive");
    data(request("GET", path(), owner, null), 200);
    problem(put(body(0), owner, "*"), 409);
    problem(put(body(0), owner), 409);
    assertThat(requirementAudits()).isEqualTo(1);
  }

  @Test
  void auditIsMinimalTenantScopedAndRollbackIsAtomic() throws Exception {
    var b = body(0);
    b.put("productType", "Private type");
    b.put("notes", "Private notes");
    data(put(b, owner, "*"), 201);
    data(put(body(0), owner), 200);
    var rows =
        jdbc.sql(
                "SELECT * FROM audit_event WHERE entity_type='StyleRequirement' AND entity_id=:id"
                    + " ORDER BY occurred_at,id")
            .param("id", style.id())
            .query()
            .listOfRows();
    assertThat(rows).hasSize(2);
    for (var row : rows) {
      assertThat(row.get("scope")).isEqualTo("ORGANIZATION");
      assertThat(row.get("organization_id")).isEqualTo(org);
      assertThat(row.get("actor_subject")).isEqualTo(owner);
      assertThat(row.get("actor_issuer")).isEqualTo("urn:source-os:local");
      assertThat(row.get("request_id")).isEqualTo("workspace-reference");
      assertThat(row.get("entity_id")).isEqualTo(style.id());
      var after = json.readTree(row.get("after_state").toString());
      assertThat(after.size()).isEqualTo(2);
      assertThat(after.has("styleId")).isTrue();
      assertThat(after.has("version")).isTrue();
      assertThat(row.toString()).doesNotContain("Private type", "Private notes", "targetCost");
    }
    actor(owner);
    assertThatThrownBy(
            () ->
                transaction()
                    .execute(
                        tx -> {
                          requirements.write(
                              org,
                              project.id(),
                              style.id(),
                              input(1, "Rolled back"),
                              null,
                              "rollback");
                          throw new IllegalStateException("rollback");
                        }))
        .isInstanceOf(IllegalStateException.class);
    assertThat(requirements.read(org, project.id(), style.id()).version()).isEqualTo(1);
    assertThat(requirementAudits()).isEqualTo(2);
  }
}
