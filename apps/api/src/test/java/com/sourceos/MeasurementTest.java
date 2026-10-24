package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class MeasurementTest extends MeasurementSupport {
  @Test
  void completeSnapshotsProvenanceAuditAndParentIndependence() throws Exception {
    var globals = new LinkedHashMap<String, List<String>>();
    for (String t :
        List.of(
            "material",
            "material_variant",
            "supplier_material_listing",
            "material_price",
            "material_inventory_snapshot",
            "supplier_profile",
            "facility",
            "facility_capability"))
      globals.put(
          t,
          jdbc.sql("SELECT row_to_json(t)::text FROM " + t + " t ORDER BY 1")
              .query(String.class)
              .list());
    var result = data(put(body(), owner, " \t*\t "), 201);
    var id = UUID.fromString(result.get("id").asString());
    var first = result.get("latestRevision");
    assertThat(first.get("revisionNumber").asLong()).isEqualTo(1);
    assertThat(first.get("points").get(0).get("value").isString()).isTrue();
    assertThat(first.get("points").get(0).get("value").asString()).isEqualTo("12.5000");
    assertThat(first.get("baseSize").asString()).isEqualTo("M");
    assertThat(first.get("points").get(0).get("label").asString()).isEqualTo("Chest");
    assertThat(first.get("points").get(0).get("notes").asString()).isEqualTo("synthetic\nPOM note");
    assertThat(first.propertyNames())
        .doesNotContain("sealed", "createdByIssuer", "createdBySubject", "status");
    assertThat(audits()).isEqualTo(2);
    var second = data(request("POST", path() + "/revisions", owner, revisionBody(1)), 201);
    assertThat(second.get("revisionNumber").asLong()).isEqualTo(2);
    assertThat(
            data(
                request("GET", path() + "/revisions/" + first.get("id").asString(), owner, null),
                200))
        .isEqualTo(first);
    actor(owner);
    assertThat(measurements.read(org, project.id(), style.id()).latestRevision().id().toString())
        .isEqualTo(second.get("id").asString());
    assertThat(projects.read(org, project.id()).version()).isZero();
    assertThat(styles.read(org, project.id(), style.id()).version()).isZero();
    var provenance =
        jdbc.sql(
                "SELECT created_by_issuer,created_by_subject,sealed FROM measurement_revision WHERE"
                    + " measurement_spec_id=:id")
            .param("id", id)
            .query()
            .listOfRows();
    assertThat(provenance).hasSize(2);
    provenance.forEach(
        r -> {
          assertThat(r.get("created_by_issuer")).isEqualTo("urn:source-os:local");
          assertThat(r.get("created_by_subject")).isEqualTo(owner);
          assertThat(r.get("sealed")).isEqualTo(true);
        });
    assertThat(audits()).isEqualTo(3);
    globals.forEach(
        (t, rows) ->
            assertThat(
                    jdbc.sql("SELECT row_to_json(t)::text FROM " + t + " t ORDER BY 1")
                        .query(String.class)
                        .list())
                .isEqualTo(rows));
    var states =
        jdbc.sql(
                "SELECT action,after_state::text FROM audit_event WHERE organization_id=:org AND"
                    + " entity_type IN ('MeasurementSpec','MeasurementRevision')")
            .param("org", org)
            .query()
            .listOfRows();
    for (var r : states) {
      var state = json.readTree((String) r.get("after_state"));
      assertThat(state.propertyNames())
          .containsExactlyInAnyOrderElementsOf(
              r.get("action").equals("measurement_spec.created")
                  ? Set.of("styleId")
                  : Set.of("styleId", "measurementSpecId", "measurementRevisionNumber"));
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"OWNER", "ADMIN", "VIEWER", "PLATFORM", "FOREIGN", "NONE"})
  void authorizationAcrossAllOperations(String role) throws Exception {
    var first = create();
    String who =
        switch (role) {
          case "OWNER" -> owner;
          case "ADMIN", "VIEWER" -> {
            String s = "measurement-" + id();
            membership(org, s, role.equals("ADMIN") ? "ORG_ADMIN" : "VIEWER", "ACTIVE");
            yield s;
          }
          case "PLATFORM" -> admin();
          case "FOREIGN" -> foreignOwner;
          default -> null;
        };
    boolean read = Set.of("OWNER", "ADMIN", "VIEWER").contains(role),
        write = Set.of("OWNER", "ADMIN").contains(role);
    int denied = who == null ? 401 : 403;
    for (String url :
        List.of(
            path(), path() + "/revisions", path() + "/revisions/" + first.latestRevision().id())) {
      var r = request("GET", url, who, null);
      if (read) r.andExpect(status().isOk());
      else problem(r, denied);
    }
    actor(owner);
    var fresh =
        styles.create(
            org,
            project.id(),
            new com.sourceos.style.StyleService.CreateInput(null, "Synthetic other Style", null),
            "measurement-test");
    String freshPath = path().replace(style.id().toString(), fresh.id().toString());
    var put =
        MockMvcRequestBuilders.put(freshPath)
            .header("X-Request-ID", "workspace-reference")
            .header("If-None-Match", "*")
            .contentType("application/json")
            .content(json.writeValueAsString(body()));
    if (who != null) put.header("X-Dev-Subject", who);
    var initial = mvc.perform(put);
    if (write) {
      initial.andExpect(status().isCreated());
      assertThat(
              jdbc.sql("SELECT created_by_subject FROM measurement_revision WHERE style_id=:s")
                  .param("s", fresh.id())
                  .query(String.class)
                  .single())
          .isEqualTo(who);
    } else problem(initial, denied);
    long before = audits();
    var r = request("POST", path() + "/revisions", who, revisionBody(1));
    if (write) r.andExpect(status().isCreated());
    else {
      problem(r, denied);
      assertThat(audits()).isEqualTo(before);
    }
    if (write) {
      var raw =
          jdbc.sql(
                  "SELECT created_by_subject FROM measurement_revision WHERE style_id=:style AND"
                      + " revision_number=2")
              .param("style", style.id())
              .query(String.class)
              .single();
      assertThat(raw).isEqualTo(who);
    }
  }

  @Test
  void absenceHierarchyRevocationAndNoForeignFacts() throws Exception {
    problem(request("GET", path(), owner, null), 404);
    problem(request("GET", path() + "/revisions", owner, null), 404);
    problem(request("POST", path() + "/revisions", owner, revisionBody(1)), 404);
    var ours = create();
    actor(foreignOwner);
    var theirs =
        measurements.create(
            foreignOrg,
            foreignProject.id(),
            foreignStyle.id(),
            input(),
            List.of("*"),
            "measurement-test");
    actor(owner);
    for (String url :
        List.of(
            path().replace(project.id().toString(), foreignProject.id().toString()),
            path().replace(style.id().toString(), foreignStyle.id().toString()),
            path() + "/revisions/" + theirs.latestRevision().id()))
      problem(request("GET", url, owner, null), 404);
    for (String wrong :
        List.of(
            path().replace(project.id().toString(), foreignProject.id().toString()),
            path().replace(style.id().toString(), foreignStyle.id().toString()))) {
      var put =
          MockMvcRequestBuilders.put(wrong)
              .header("X-Dev-Subject", owner)
              .header("X-Request-ID", "workspace-reference")
              .header("If-None-Match", "*")
              .contentType("application/json")
              .content(json.writeValueAsString(body()));
      problem(mvc.perform(put), 404);
      problem(request("POST", wrong + "/revisions", owner, revisionBody(1)), 404);
    }
    long before = audits();
    problem(request("POST", path() + "/revisions", owner, revisionBody(9)), 409);
    problem(put(body(), owner, "*"), 412);
    assertThat(audits()).isEqualTo(before);
    jdbc.sql(
            "UPDATE membership SET status='REVOKED',version=version+1 WHERE organization_id=:org"
                + " AND subject=:who")
        .param("org", org)
        .param("who", owner)
        .update();
    for (String url :
        List.of(path(), path() + "/revisions", path() + "/revisions/" + ours.latestRevision().id()))
      problem(request("GET", url, owner, null), 403);
    problem(put(body(), owner, "*"), 403);
    problem(request("POST", path() + "/revisions", owner, revisionBody(1)), 403);
    assertThat(audits()).isEqualTo(before);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void archivedParentReadsWritesAndReactivation(boolean isStyle) throws Exception {
    var first = create();
    data(request("PUT", detail(isStyle), owner, replacement(isStyle, "ARCHIVED", 0)), 200);
    long n = audits();
    request("GET", path(), owner, null).andExpect(status().isOk());
    request("GET", path() + "/revisions/" + first.latestRevision().id(), owner, null)
        .andExpect(status().isOk());
    problem(put(body(), owner, "*"), 409);
    problem(request("POST", path() + "/revisions", owner, revisionBody(1)), 409);
    assertThat(audits()).isEqualTo(n);
    data(request("PUT", detail(isStyle), owner, replacement(isStyle, "ACTIVE", 1)), 200);
    actor(owner);
    assertThat(measurements.read(org, project.id(), style.id())).isEqualTo(first);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void archiveBeforeInitialCreatesNoMeasurementRows(boolean parent) throws Exception {
    data(request("PUT", detail(parent), owner, replacement(parent, "ARCHIVED", 0)), 200);
    problem(put(body(), owner, "*"), 409);
    assertThat(count("measurement_spec")).isZero();
    assertThat(audits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "abc", "W/\"x\"", "*, *", "\"*\"", "**"})
  void invalidPrecondition(String header) throws Exception {
    problem(put(body(), owner, header), 400);
    assertThat(count("measurement_spec")).isZero();
    assertThat(audits()).isZero();
  }

  @Test
  void domainPreconditionRejectsNonHttpWhitespace() {
    for (String h : List.of("\n*", "\u2003*")) {
      assertThatThrownBy(
              () ->
                  measurements.create(
                      org, project.id(), style.id(), input(), List.of(h), "measurement-test"))
          .isInstanceOfSatisfying(
              org.springframework.web.server.ResponseStatusException.class,
              e -> assertThat(e.getStatusCode().value()).isEqualTo(400));
    }
    assertThat(count("measurement_spec")).isZero();
    assertThat(audits()).isZero();
  }

  @Test
  void missingAndMultipleHeaders() throws Exception {
    problem(put(body(), owner), 400);
    problem(put(body(), owner, "*", "*"), 400);
    assertThat(audits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "id",
        "styleId",
        "measurementSpecId",
        "revisionId",
        "revisionNumber",
        "position",
        "sealed",
        "createdBy",
        "createdAt",
        "organizationId",
        "projectId",
        "createdByIssuer",
        "createdBySubject"
      })
  void unknownAuthorityFields(String field) throws Exception {
    var b = body();
    b.put(field, "synthetic");
    problem(put(b, owner, "*"), 400);
    assertThat(audits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"-1", "+1", "1e3", ".5", "1.", "NaN", "Infinity", "1000000000000000", "0.00001"})
  void invalidDecimal(String decimal) throws Exception {
    var p = point();
    p.put("value", decimal);
    var b = body();
    b.put("points", List.of(p));
    problem(put(b, owner, "*"), 400);
    assertThat(audits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"0", "0.0000", "12.5", "00012.5", "999999999999999.9999"})
  void exactDecimalValues(String decimal) throws Exception {
    var p = point();
    p.put("value", decimal);
    var b = body();
    b.put("points", List.of(p));
    var r = data(put(b, owner, "*"), 201);
    assertThat(r.get("latestRevision").get("points").get(0).get("value").isString()).isTrue();
  }

  @ParameterizedTest
  @ValueSource(strings = {"expectedLatestRevisionNumber", "baseSize", "unitSystem", "points"})
  void missingRevisionFields(String field) throws Exception {
    create();
    var b = revisionBody(1);
    b.remove(field);
    problem(request("POST", path() + "/revisions", owner, b), 400);
    assertThat(audits()).isEqualTo(2);
  }

  @ParameterizedTest
  @ValueSource(strings = {"baseSize", "unitSystem", "points"})
  void initialRequiredFields(String field) throws Exception {
    var b = body();
    b.remove(field);
    problem(put(b, owner, "*"), 400);
    assertThat(audits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"code", "label", "value"})
  void pointRequiredFields(String field) throws Exception {
    var b = body();
    var p = point();
    p.remove(field);
    b.put("points", List.of(p));
    problem(put(b, owner, "*"), 400);
    assertThat(audits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"MM", "CM", "IN"})
  void explicitUnits(String unit) throws Exception {
    var b = body();
    b.put("unitSystem", unit);
    assertThat(data(put(b, owner, "*"), 201).get("latestRevision").get("unitSystem").asString())
        .isEqualTo(unit);
  }

  @Test
  void strictShapesAndDuplicateCodes() throws Exception {
    var invalid = new ArrayList<Map<String, Object>>();
    var b = body();
    b.put("points", List.of(point(), point()));
    invalid.add(b);
    b = body();
    var p = point();
    p.put("value", 12.5);
    b.put("points", List.of(p));
    invalid.add(b);
    for (Object v : List.of(1, true, List.of("M"), Map.of("x", "M"))) {
      b = body();
      b.put("baseSize", v);
      invalid.add(b);
    }
    for (String code : List.of("lower", " A", "A ", "A B", "_A", "A?")) {
      b = body();
      p = point();
      p.put("code", code);
      b.put("points", List.of(p));
      invalid.add(b);
    }
    b = body();
    p = point();
    p.put("position", 0);
    b.put("points", List.of(p));
    invalid.add(b);
    b = body();
    b.put("points", List.of());
    invalid.add(b);
    b = body();
    b.put("unitSystem", "mm");
    invalid.add(b);
    for (var v : invalid) problem(put(v, owner, "*"), 400);
    assertThat(count("measurement_spec")).isZero();
    assertThat(audits()).isZero();
    create();
    for (Object head : List.of("1", 1.0, 0, -1, 9007199254740992L, true)) {
      b = revisionBody(1);
      b.put("expectedLatestRevisionNumber", head);
      problem(request("POST", path() + "/revisions", owner, b), 400);
    }
  }

  @Test
  void anchoredHistoryDoesNotDriftAndHasNoPointHydration() throws Exception {
    var first = create();
    for (long n = 1; n < 31; n++)
      measurements.createRevision(org, project.id(), style.id(), revision(n), "measurement-test");
    var page = measurements.history(org, project.id(), style.id(), 25, 31L);
    assertThat(page.items()).hasSize(25);
    assertThat(page.nextMaxRevisionNumber()).isEqualTo(6);
    measurements.createRevision(org, project.id(), style.id(), revision(31), "measurement-test");
    var older =
        measurements.history(org, project.id(), style.id(), 25, page.nextMaxRevisionNumber());
    assertThat(older.items()).hasSize(6);
    assertThat(older.nextMaxRevisionNumber()).isNull();
    var nums = new ArrayList<Long>();
    page.items().forEach(r -> nums.add(r.revisionNumber()));
    older.items().forEach(r -> nums.add(r.revisionNumber()));
    assertThat(nums)
        .containsExactlyElementsOf(
            java.util.stream.LongStream.iterate(31, n -> n > 0, n -> n - 1).boxed().toList());
    for (String query :
        List.of(
            "?limit=0",
            "?limit=101",
            "?maxRevisionNumber=0",
            "?maxRevisionNumber=9007199254740992",
            "?maxRevisionNumber=1.5"))
      problem(request("GET", path() + "/revisions" + query, owner, null), 400);
  }

  @Test
  void lateFailureRollsBackSealedCompleteRowsAndAudit() {
    assertThatThrownBy(
            () ->
                transaction()
                    .executeWithoutResult(
                        tx -> {
                          var s = create();
                          assertThat(count("measurement_point")).isEqualTo(1);
                          assertThat(audits()).isEqualTo(2);
                          throw new IllegalStateException(
                              "Synthetic late failure after seal and audit");
                        }))
        .isInstanceOf(IllegalStateException.class);
    for (String t : List.of("measurement_spec", "measurement_revision", "measurement_point"))
      assertThat(count(t)).isZero();
    assertThat(audits()).isZero();
  }
}
