package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.pattern.PatternService;
import com.sourceos.style.StyleService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;

class PatternTest extends PatternSupport {
  @Test
  void snapshotsPinsLifecycleAuditAndIndependentParents() throws Exception {
    var ms = create();
    var pin = ms.latestRevision().id();
    var globals = new LinkedHashMap<String, List<String>>();
    for (String t :
        List.of(
            "measurement_spec",
            "measurement_revision",
            "measurement_point",
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
    var b = patternBody();
    b.put("measurementRevisionId", pin);
    var first = data(request("POST", base(), owner, b), 201);
    var id = UUID.fromString(first.get("id").asString());
    var r = first.get("latestRevision");
    assertThat(first.get("version").asLong()).isZero();
    assertThat(r.get("name").asString()).isEqualTo("Main Pattern");
    assertThat(r.propertyNames())
        .doesNotContain(
            "createdByIssuer", "createdBySubject", "sourceKind", "qualityState", "artifact");
    assertThat(patternAudits()).isEqualTo(2);
    actor(owner);
    var p = patterns.read(org, project.id(), style.id(), id);
    var saved = patterns.createRevision(org, project.id(), style.id(), id, next(1), "pattern-test");
    assertThat(saved.measurementRevisionId()).isNull();
    var afterRevision = patterns.read(org, project.id(), style.id(), id);
    assertThat(afterRevision.version()).isEqualTo(p.version());
    assertThat(afterRevision.updatedAt()).isEqualTo(p.updatedAt());
    assertThat(
            patterns
                .readRevision(
                    org, project.id(), style.id(), id, UUID.fromString(r.get("id").asString()))
                .measurementRevisionId())
        .isEqualTo(pin);
    var all =
        jdbc.sql(
                "SELECT row_to_json(r)::text FROM pattern_revision r WHERE pattern_id=:id ORDER BY"
                    + " revision_number")
            .param("id", id)
            .query(String.class)
            .list();
    var archived =
        patterns.lifecycle(
            org,
            project.id(),
            style.id(),
            id,
            new PatternService.LifecycleInput(PatternService.Status.ARCHIVED, 0L),
            "pattern-test");
    assertThat(archived.version()).isEqualTo(1);
    long a = patternAudits();
    assertThat(
            patterns.lifecycle(
                org,
                project.id(),
                style.id(),
                id,
                new PatternService.LifecycleInput(PatternService.Status.ARCHIVED, 1L),
                "pattern-test"))
        .isEqualTo(archived);
    assertThat(patternAudits()).isEqualTo(a);
    assertThatThrownBy(
            () ->
                patterns.lifecycle(
                    org,
                    project.id(),
                    style.id(),
                    id,
                    new PatternService.LifecycleInput(PatternService.Status.ARCHIVED, 0L),
                    "pattern-test"))
        .hasMessageContaining("409");
    assertThatThrownBy(
            () ->
                patterns.createRevision(org, project.id(), style.id(), id, next(2), "pattern-test"))
        .hasMessageContaining("409");
    var active =
        patterns.lifecycle(
            org,
            project.id(),
            style.id(),
            id,
            new PatternService.LifecycleInput(PatternService.Status.ACTIVE, 1L),
            "pattern-test");
    assertThat(active.version()).isEqualTo(2);
    assertThat(active.latestRevision().id()).isEqualTo(saved.id());
    assertThat(
            jdbc.sql(
                    "SELECT row_to_json(r)::text FROM pattern_revision r WHERE pattern_id=:id ORDER"
                        + " BY revision_number")
                .param("id", id)
                .query(String.class)
                .list())
        .isEqualTo(all);
    assertThat(projects.read(org, project.id()).version()).isZero();
    assertThat(styles.read(org, project.id(), style.id()).version()).isZero();
    globals.forEach(
        (t, rows) ->
            assertThat(
                    jdbc.sql("SELECT row_to_json(t)::text FROM " + t + " t ORDER BY 1")
                        .query(String.class)
                        .list())
                .as(t)
                .isEqualTo(rows));
    measurements.createRevision(org, project.id(), style.id(), revision(1), "measurement-next");
    assertThat(
            patterns
                .readRevision(
                    org, project.id(), style.id(), id, UUID.fromString(r.get("id").asString()))
                .measurementRevisionId())
        .isEqualTo(pin);
    assertThat(
            jdbc.sql("SELECT created_by_subject FROM pattern_revision WHERE pattern_id=:id")
                .param("id", id)
                .query(String.class)
                .list())
        .containsOnly(owner);
    for (var row :
        jdbc.sql(
                "SELECT entity_type,after_state::text FROM audit_event WHERE organization_id=:org"
                    + " AND entity_type IN ('Pattern','PatternRevision')")
            .param("org", org)
            .query()
            .listOfRows()) {
      var state = json.readTree((String) row.get("after_state"));
      assertThat(state.propertyNames())
          .doesNotContain("name", "purpose", "createdByIssuer", "createdBySubject");
      assertThat(state.propertyNames())
          .isSubsetOf(
              "styleId",
              "status",
              "version",
              "patternId",
              "patternRevisionNumber",
              "measurementRevisionId");
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"OWNER", "ADMIN", "VIEWER", "PLATFORM", "FOREIGN", "NONE"})
  void allSevenOperationsAuthorizeBeforePrivateLookup(String role) throws Exception {
    var p = pattern();
    String who =
        switch (role) {
          case "OWNER" -> owner;
          case "ADMIN", "VIEWER" -> {
            String s = "pattern-" + id();
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
    String d = base() + "/" + p.id();
    for (String url :
        List.of(base(), d, d + "/revisions", d + "/revisions/" + p.latestRevision().id()))
      if (read) data(request("GET", url, who, null), 200);
      else problem(request("GET", url, who, null), denied);
    data(request("POST", base(), who, patternBody()), write ? 201 : denied);
    data(
        request(
            "POST",
            d + "/revisions",
            who,
            Map.of("name", "New", "expectedLatestRevisionNumber", 1)),
        write ? 201 : denied);
    data(request("PUT", d, who, Map.of("status", "ARCHIVED", "version", 0)), write ? 200 : denied);
    if (write) {
      assertThat(
              jdbc.sql(
                      "SELECT created_by_subject FROM pattern_revision WHERE pattern_id=:id AND"
                          + " revision_number=2")
                  .param("id", p.id())
                  .query(String.class)
                  .single())
          .isEqualTo(who);
    } else assertThat(patternAudits()).isEqualTo(2);
  }

  @Test
  void scopedHierarchyRevocationAndProvider() throws Exception {
    var m = create();
    var p = pattern();
    String d = base() + "/" + p.id();
    for (String url :
        List.of(
            base().replace(project.id().toString(), foreignProject.id().toString()),
            base().replace(style.id().toString(), foreignStyle.id().toString()),
            base() + "/" + id(),
            d + "/revisions/" + id())) problem(request("GET", url, owner, null), 404);
    actor(owner);
    var other =
        styles.create(
            org, project.id(), new StyleService.CreateInput(null, "Other", null), "pattern-test");
    var wrong = patternBody();
    wrong.put("measurementRevisionId", m.latestRevision().id());
    String otherBase = base().replace(style.id().toString(), other.id().toString());
    problem(request("POST", otherBase, owner, wrong), 404);
    actor(owner);
    var ref = measurements.referenceContext(org, project.id(), style.id(), m.latestRevision().id());
    assertThat(ref.revisionId()).isEqualTo(m.latestRevision().id());
    assertThat(ref.styleId()).isEqualTo(style.id());
    problem(
        request(
            "POST",
            d + "/revisions",
            owner,
            Map.of(
                "name", "Bad", "expectedLatestRevisionNumber", 1, "measurementRevisionId", id())),
        404);
    jdbc.sql(
            "UPDATE membership SET status='REVOKED',version=version+1 WHERE organization_id=:org"
                + " AND subject=:who")
        .param("org", org)
        .param("who", owner)
        .update();
    for (String url :
        List.of(base(), d, d + "/revisions", d + "/revisions/" + p.latestRevision().id()))
      problem(request("GET", url, owner, null), 403);
    problem(request("POST", base(), owner, patternBody()), 403);
    problem(
        request(
            "POST",
            d + "/revisions",
            owner,
            Map.of("name", "New", "expectedLatestRevisionNumber", 1)),
        403);
    problem(request("PUT", d, owner, Map.of("status", "ARCHIVED", "version", 0)), 403);
    assertThat(patternAudits()).isEqualTo(2);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void archivedParentsReadOnly(boolean isStyle) throws Exception {
    var p = pattern();
    String d = base() + "/" + p.id();
    data(request("PUT", detail(isStyle), owner, replacement(isStyle, "ARCHIVED", 0)), 200);
    for (String url :
        List.of(base(), d, d + "/revisions", d + "/revisions/" + p.latestRevision().id()))
      data(request("GET", url, owner, null), 200);
    problem(request("POST", base(), owner, patternBody()), 409);
    problem(
        request(
            "POST",
            d + "/revisions",
            owner,
            Map.of("name", "Next", "expectedLatestRevisionNumber", 1)),
        409);
    problem(request("PUT", d, owner, Map.of("status", "ARCHIVED", "version", 0)), 409);
    data(request("PUT", detail(isStyle), owner, replacement(isStyle, "ACTIVE", 1)), 200);
    actor(owner);
    assertThat(patterns.read(org, project.id(), style.id(), p.id())).isEqualTo(p);
    assertThat(patternAudits()).isEqualTo(2);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "id",
        "patternId",
        "revisionId",
        "revisionNumber",
        "styleId",
        "status",
        "version",
        "createdAt",
        "createdBy",
        "artifactId",
        "sourceKind",
        "qualityState"
      })
  void unknownCreateFields(String f) throws Exception {
    var b = patternBody();
    b.put(f, "forbidden");
    problem(request("POST", base(), owner, b), 400);
    assertThat(patternCount("pattern")).isZero();
    assertThat(patternAudits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"\"1\"", "1.0", "1e0", "0", "-1", "9007199254740992", "null"})
  void strictRevisionBaseline(String token) throws Exception {
    var p = pattern();
    var b = json.readTree("{\"name\":\"Next\",\"expectedLatestRevisionNumber\":" + token + "}");
    problem(request("POST", base() + "/" + p.id() + "/revisions", owner, b), 400);
    assertThat(patternAudits()).isEqualTo(2);
  }

  @Test
  void strictTextUuidsLifecycleAndFilters() throws Exception {
    for (Object name : List.of(" ", "x".repeat(161), 42)) {
      var b = patternBody();
      b.put("name", name);
      problem(request("POST", base(), owner, b), 400);
    }
    for (Object pin : List.of("bad", "1-1-1-1-1", 42)) {
      var b = patternBody();
      b.put("measurementRevisionId", pin);
      problem(request("POST", base(), owner, b), 400);
    }
    var p = pattern();
    String d = base() + "/" + p.id();
    for (Object v : List.of("0", 0.5, -1, 9007199254740992L))
      problem(request("PUT", d, owner, Map.of("status", "ARCHIVED", "version", v)), 400);
    problem(request("PUT", d, owner, Map.of("status", "REVIEWED", "version", 0)), 400);
    problem(request("GET", base() + "?status=INVALID", owner, null), 400);
    problem(request("GET", base() + "?limit=0", owner, null), 400);
  }

  @Test
  void listKeysetsFilterBindingHistoryAndDuplicateNames() throws Exception {
    var a = pattern();
    var b = pattern();
    actor(owner);
    var page = patterns.list(org, project.id(), style.id(), PatternService.Filter.ACTIVE, 1, null);
    assertThat(page.items()).hasSize(1);
    assertThat(page.nextCursor()).isNotNull();
    var c = pattern();
    actor(owner);
    var old =
        patterns.list(
            org, project.id(), style.id(), PatternService.Filter.ACTIVE, 1, page.nextCursor());
    assertThat(old.items()).hasSize(1);
    assertThat(old.items().getFirst().id())
        .isNotEqualTo(c.id())
        .isNotEqualTo(page.items().getFirst().id());
    assertThatThrownBy(
            () ->
                patterns.list(
                    org, project.id(), style.id(), PatternService.Filter.ALL, 1, page.nextCursor()))
        .hasMessageContaining("400");
    var other =
        styles.create(
            org, project.id(), new StyleService.CreateInput(null, "Other", null), "pattern-test");
    assertThatThrownBy(
            () ->
                patterns.list(
                    org,
                    project.id(),
                    other.id(),
                    PatternService.Filter.ACTIVE,
                    1,
                    page.nextCursor()))
        .hasMessageContaining("400");
    patterns.lifecycle(
        org,
        project.id(),
        style.id(),
        a.id(),
        new PatternService.LifecycleInput(PatternService.Status.ARCHIVED, 0L),
        "pattern-test");
    assertThat(
            patterns
                .list(org, project.id(), style.id(), PatternService.Filter.ARCHIVED, 25, null)
                .items())
        .extracting(PatternService.Summary::id)
        .containsExactly(a.id());
    assertThat(
            patterns
                .list(org, project.id(), style.id(), PatternService.Filter.ALL, 25, null)
                .items())
        .hasSize(3);
    for (int n = 1; n < 28; n++)
      patterns.createRevision(org, project.id(), style.id(), b.id(), next(n), "pattern-test");
    var h = patterns.history(org, project.id(), style.id(), b.id(), 25, 28L);
    assertThat(h.nextMaxRevisionNumber()).isEqualTo(3);
    patterns.createRevision(org, project.id(), style.id(), b.id(), next(28), "pattern-test");
    var older =
        patterns.history(org, project.id(), style.id(), b.id(), 25, h.nextMaxRevisionNumber());
    assertThat(older.items())
        .extracting(PatternService.RevisionSummary::revisionNumber)
        .containsExactly(3L, 2L, 1L);
  }

  @Test
  void foreignPatternAndRevisionIdsAreScopedBeforeDisclosure() throws Exception {
    var own = pattern();
    actor(foreignOwner);
    var foreign =
        patterns.create(
            foreignOrg,
            foreignProject.id(),
            foreignStyle.id(),
            new PatternService.CreateInput("Foreign private Pattern", null, null),
            "foreign-pattern");
    problem(request("GET", base() + "/" + foreign.id(), owner, null), 404);
    problem(
        request(
            "GET",
            base() + "/" + own.id() + "/revisions/" + foreign.latestRevision().id(),
            owner,
            null),
        404);
    problem(
        request(
            "PUT", base() + "/" + foreign.id(), owner, Map.of("status", "ARCHIVED", "version", 0)),
        404);
    problem(
        request(
            "POST",
            base() + "/" + foreign.id() + "/revisions",
            owner,
            Map.of("name", "Private", "expectedLatestRevisionNumber", 1)),
        404);
    actor(owner);
    String otherResource =
        com.sourceos.shared.Keysets.encode(
            "created-desc",
            com.sourceos.shared.Keysets.hash(List.of(style.id(), PatternService.Filter.ACTIVE)),
            own.createdAt() + "|" + own.id());
    assertThatThrownBy(
            () ->
                patterns.list(
                    org, project.id(), style.id(), PatternService.Filter.ACTIVE, 25, otherResource))
        .hasMessageContaining("400");
    assertThat(patternAudits()).isEqualTo(2);
  }

  @Test
  void lateRollbackAfterBothAudits() {
    long before = patternAudits();
    assertThatThrownBy(
            () ->
                transaction()
                    .execute(
                        t -> {
                          var p = pattern();
                          assertThat(patternCount("pattern")).isEqualTo(1);
                          assertThat(patternCount("pattern_revision")).isEqualTo(1);
                          assertThat(patternAudits()).isEqualTo(before + 2);
                          throw new IllegalStateException("Synthetic late rollback");
                        }))
        .isInstanceOf(IllegalStateException.class);
    assertThat(patternCount("pattern")).isZero();
    assertThat(patternCount("pattern_revision")).isZero();
    assertThat(patternAudits()).isEqualTo(before);
  }
}
