package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.grading.GradingModels.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class GradingTest extends GradingSupport {
  @Test
  void collectionCursorBindsWholeHierarchyResourceAndFilterAndHistoryIsAnchored() {
    var first = grade();
    grade();
    grade();
    var page = grading.list(org, project.id(), style.id(), Filter.ACTIVE, 1, null);
    assertThat(page.items()).hasSize(1);
    assertThat(page.nextCursor()).isNotBlank();
    var second = grading.list(org, project.id(), style.id(), Filter.ACTIVE, 1, page.nextCursor());
    assertThat(second.items()).hasSize(1);
    assertThat(second.items().getFirst().id()).isNotEqualTo(page.items().getFirst().id());
    assertThatThrownBy(
            () -> grading.list(org, project.id(), style.id(), Filter.ALL, 1, page.nextCursor()))
        .hasMessageContaining("400");
    membership(foreignOrg, owner, "ORG_OWNER", "ACTIVE");
    assertThatThrownBy(
            () ->
                grading.list(
                    foreignOrg,
                    foreignProject.id(),
                    foreignStyle.id(),
                    Filter.ACTIVE,
                    1,
                    page.nextCursor()))
        .hasMessageContaining("400");
    String otherResource =
        com.sourceos.shared.Keysets.encode(
            "created-desc",
            com.sourceos.shared.Keysets.hash(
                List.of("patterns", org, project.id(), style.id(), Filter.ACTIVE)),
            first.createdAt() + "|" + first.id());
    assertThatThrownBy(
            () -> grading.list(org, project.id(), style.id(), Filter.ACTIVE, 1, otherResource))
        .hasMessageContaining("400");
    for (int n = 1; n < 31; n++)
      grading.createRevision(org, project.id(), style.id(), first.id(), next(n), "grading-history");
    var history = grading.history(org, project.id(), style.id(), first.id(), 25, 31L);
    assertThat(history.items()).hasSize(25);
    assertThat(history.items().getFirst().revisionNumber()).isEqualTo(31);
    assertThat(history.items().getLast().revisionNumber()).isEqualTo(7);
    assertThat(history.nextMaxRevisionNumber()).isEqualTo(6L);
    grading.createRevision(org, project.id(), style.id(), first.id(), next(31), "grading-history");
    var older =
        grading.history(
            org, project.id(), style.id(), first.id(), 25, history.nextMaxRevisionNumber());
    assertThat(older.items())
        .extracting(RevisionSummary::revisionNumber)
        .containsExactly(6L, 5L, 4L, 3L, 2L, 1L);
    assertThat(older.nextMaxRevisionNumber()).isNull();
    assertThat(grading.read(org, project.id(), style.id(), first.id()).updatedAt())
        .isEqualTo(first.updatedAt());
  }

  @Test
  void generatedContractHasExactlySevenOperationsAndCorrectDecimalGrammar() throws Exception {
    var doc = data(request("GET", "/v3/api-docs", owner, null), 200);
    var schemas = doc.get("components").get("schemas");
    String pattern =
        schemas.get("GradeRuleValueInput").get("properties").get("delta").get("pattern").asString();
    assertThat("-2.5000").matches(pattern);
    assertThat("0").matches(pattern);
    assertThat("1e2").doesNotMatch(pattern);
    assertThat("0.00001").doesNotMatch(pattern);
    for (String name :
        List.of(
            "GradeRuleSetCreateInput",
            "GradeRuleSetRevisionCreateInput",
            "GradeSizeInput",
            "GradeRuleInput",
            "GradeRuleValueInput"))
      assertThat(schemas.get(name).get("additionalProperties").asBoolean()).isFalse();
    long operations = 0;
    for (String path : doc.get("paths").propertyNames())
      if (path.contains("/grade-rule-sets"))
        operations += doc.get("paths").get(path).propertyNames().size();
    assertThat(operations).isEqualTo(7);
  }

  @Test
  void completeSnapshotsLifecycleNoopHistoryAndAudit() throws Exception {
    var first = data(request("POST", base(), owner, body()), 201);
    var id = UUID.fromString(first.get("id").asString());
    var r = first.get("latestRevision");
    assertThat(r.get("name").asString()).isEqualTo("Core sizes");
    assertThat(r.get("notes").isNull()).isTrue();
    assertThat(r.propertyNames())
        .doesNotContain(
            "sealed", "createdByIssuer", "createdBySubject", "patternId", "measurementRevisionId");
    assertThat(r.get("sizes").get(1).get("code").asString()).isEqualTo("S1");
    assertThat(r.get("rules").get(0).get("values").get(0).get("delta").asString())
        .isEqualTo("-123456789012345.6789");
    assertThat(gradingAudits()).isEqualTo(2);
    actor(owner);
    var initial = grading.read(org, project.id(), style.id(), id);
    for (int n = 1; n <= 2; n++)
      grading.createRevision(org, project.id(), style.id(), id, next(n), "grading-test");
    var current = grading.read(org, project.id(), style.id(), id);
    assertThat(current.version()).isZero();
    assertThat(current.updatedAt()).isEqualTo(initial.updatedAt());
    assertThat(styles.read(org, project.id(), style.id()).version()).isEqualTo(style.version());
    assertThat(projects.read(org, project.id()).version()).isEqualTo(project.version());
    assertThat(
            grading.readRevision(org, project.id(), style.id(), id, initial.latestRevision().id()))
        .isEqualTo(initial.latestRevision());
    var anchored = grading.history(org, project.id(), style.id(), id, 1, 2L);
    assertThat(anchored.items()).extracting(RevisionSummary::revisionNumber).containsExactly(2L);
    assertThat(anchored.nextMaxRevisionNumber()).isEqualTo(1L);
    var url = base() + "/" + id;
    var archived =
        data(request("PUT", url, owner, Map.of("status", "ARCHIVED", "version", 0)), 200);
    assertThat(archived.get("latestRevision").propertyNames())
        .doesNotContain("sizes", "rules", "notes");
    assertThat(archived.get("latestRevision").get("sizeCount").asInt()).isEqualTo(3);
    long audits = gradingAudits();
    assertThat(data(request("PUT", url, owner, Map.of("status", "ARCHIVED", "version", 1)), 200))
        .isEqualTo(archived);
    assertThat(gradingAudits()).isEqualTo(audits);
    problem(request("PUT", url, owner, Map.of("status", "ARCHIVED", "version", 0)), 409);
    var revision = new LinkedHashMap<>(body());
    revision.put("expectedLatestRevisionNumber", 3);
    problem(request("POST", url + "/revisions", owner, revision), 409);
    data(request("GET", url, owner, null), 200);
    data(request("GET", url + "/revisions", owner, null), 200);
    data(request("PUT", url, owner, Map.of("status", "ACTIVE", "version", 1)), 200);
    data(request("POST", url + "/revisions", owner, revision), 201);
    for (var state :
        jdbc.sql(
                "SELECT after_state::text FROM audit_event WHERE organization_id=:org AND"
                    + " entity_type IN ('GradeRuleSet','GradeRuleSetRevision')")
            .param("org", org)
            .query(String.class)
            .list())
      assertThat(json.readTree(state).propertyNames())
          .doesNotContain("name", "notes", "delta", "sizes", "rules", "issuer", "subject");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "root",
        "size",
        "rule",
        "value",
        "duplicate-size",
        "duplicate-rule",
        "base",
        "missing-value",
        "extra-value",
        "wrong-order",
        "numeric-delta",
        "over-scale",
        "exponent",
        "nan",
        "infinity",
        "nonzero-base",
        "lowercase",
        "null-rule"
      })
  @SuppressWarnings("unchecked")
  void strictNestedSnapshotsRollbackWithoutAudits(String invalid) throws Exception {
    var b = body();
    var sizes = (List<Map<String, Object>>) b.get("sizes");
    var rules = (List<Map<String, Object>>) b.get("rules");
    var values = (List<Map<String, Object>>) rules.getFirst().get("values");
    switch (invalid) {
      case "root" -> b.put("position", 0);
      case "size" -> sizes.getFirst().put("position", 0);
      case "rule" -> rules.getFirst().put("position", 0);
      case "value" -> values.getFirst().put("extra", 0);
      case "duplicate-size" -> sizes.get(1).put("code", "S0");
      case "duplicate-rule" -> rules.get(1).put("code", "R0");
      case "base" -> b.put("baseSizeCode", "OTHER");
      case "missing-value" -> values.removeLast();
      case "extra-value" -> values.add(new LinkedHashMap<>(values.getFirst()));
      case "wrong-order" -> Collections.swap(values, 0, 1);
      case "numeric-delta" -> values.getFirst().put("delta", 1);
      case "over-scale" -> values.getFirst().put("delta", "0.00001");
      case "exponent" -> values.getFirst().put("delta", "1e2");
      case "nan" -> values.getFirst().put("delta", "NaN");
      case "infinity" -> values.getFirst().put("delta", "Infinity");
      case "nonzero-base" -> values.get(1).put("delta", "1");
      case "lowercase" -> sizes.getFirst().put("code", "small");
      case "null-rule" -> rules.set(0, null);
    }
    problem(request("POST", base(), owner, b), 400);
    for (String t :
        List.of(
            "grade_rule_set",
            "grade_rule_set_revision",
            "grade_size",
            "grade_rule",
            "grade_rule_value")) assertThat(gradingCount(t)).as(t).isZero();
    assertThat(gradingAudits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "duplicate-root",
        "duplicate-size",
        "duplicate-rule",
        "duplicate-value",
        "trailing"
      })
  void rawDuplicateKeysAndTrailingJsonRejected(String kind) throws Exception {
    String raw = json.writeValueAsString(body());
    raw =
        switch (kind) {
          case "duplicate-root" -> raw.replaceFirst("\\{", "{\"name\":\"Other\",");
          case "duplicate-size" ->
              raw.replaceFirst("\"code\":\"S0\"", "\"code\":\"S0\",\"code\":\"S0\"");
          case "duplicate-rule" ->
              raw.replaceFirst("\"code\":\"R0\"", "\"code\":\"R0\",\"code\":\"R0\"");
          case "duplicate-value" ->
              raw.replaceFirst("\"sizeCode\":\"S0\"", "\"sizeCode\":\"S0\",\"sizeCode\":\"S0\"");
          default -> raw + " {}";
        };
    problem(
        mvc.perform(
            MockMvcRequestBuilders.post(base())
                .header("X-Dev-Subject", owner)
                .header("X-Request-ID", "workspace-reference")
                .contentType("application/json")
                .content(raw)),
        400);
    assertThat(gradingAudits()).isZero();
  }

  @Test
  void authorizationHierarchyArchiveAndRevocation() throws Exception {
    var g = grade();
    var url = base() + "/" + g.id();
    String viewer = "viewer-" + id(), administrator = "org-admin-" + id();
    membership(org, viewer, "VIEWER", "ACTIVE");
    membership(org, administrator, "ORG_ADMIN", "ACTIVE");
    data(request("GET", url, viewer, null), 200);
    problem(request("POST", base(), viewer, body()), 403);
    data(request("POST", base(), administrator, body()), 201);
    problem(request("GET", url, foreignOwner, null), 403);
    problem(request("GET", url, admin(), null), 403);
    problem(request("GET", url, null, null), 401);
    problem(request("GET", base() + "/" + id(), owner, null), 404);
    problem(request("GET", url + "/revisions/" + id(), owner, null), 404);
    problem(
        request(
            "GET",
            url.replace(project.id().toString(), foreignProject.id().toString()),
            owner,
            null),
        404);
    problem(
        request(
            "GET", url.replace(style.id().toString(), foreignStyle.id().toString()), owner, null),
        404);
    jdbc.sql(
            "UPDATE membership SET status='REVOKED',version=version+1 WHERE organization_id=:org"
                + " AND subject=:subject")
        .param("org", org)
        .param("subject", viewer)
        .update();
    problem(request("GET", url, viewer, null), 403);
    data(request("PUT", detail(true), owner, replacement(true, "ARCHIVED", 0)), 200);
    data(request("GET", url, owner, null), 200);
    problem(request("POST", base(), owner, body()), 409);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "grade_rule_set:INSERT",
        "grade_rule_set_revision:INSERT",
        "grade_size:INSERT",
        "grade_rule:INSERT",
        "grade_rule_value:INSERT",
        "grade_rule_set_revision:UPDATE",
        "audit_event:INSERT"
      })
  void testOwnedFailureAtEveryStageRollsBack(String stage) {
    String[] split = stage.split(":");
    jdbc.sql(
            "CREATE FUNCTION grading_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
                + " RAISE EXCEPTION 'test-owned late failure'; END; $$")
        .update();
    jdbc.sql(
            "CREATE TRIGGER grading_test_failure BEFORE "
                + split[1]
                + " ON "
                + split[0]
                + " FOR EACH ROW EXECUTE FUNCTION grading_test_failure()")
        .update();
    try {
      actor(owner);
      assertThatThrownBy(
              () -> grading.create(org, project.id(), style.id(), input(), "grading-test"))
          .hasMessageContaining("test-owned late failure");
      for (String t :
          List.of(
              "grade_rule_set",
              "grade_rule_set_revision",
              "grade_size",
              "grade_rule",
              "grade_rule_value")) assertThat(gradingCount(t)).as(t).isZero();
      assertThat(gradingAudits()).isZero();
    } finally {
      jdbc.sql("DROP TRIGGER grading_test_failure ON " + split[0]).update();
      jdbc.sql("DROP FUNCTION grading_test_failure()").update();
    }
  }
}
