package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.project.ProjectService;
import com.sourceos.style.StyleService;
import com.sourceos.stylematerialselection.StyleMaterialSelectionService.Input;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.transaction.IllegalTransactionStateException;

class StyleMaterialSelectionTest extends StyleMaterialSelectionSupport {
  @Test
  void fourScopesDistinctNullsDuplicatesIndependentRefinementsAndUnlink() throws Exception {
    var rows = new ArrayList<UUID>();
    for (boolean v : List.of(false, true))
      for (boolean l : List.of(false, true)) {
        var r = data(request("POST", path(), owner, input(v, l)), 201);
        assertThat(r.size()).isEqualTo(6);
        assertThat(r.get("variantId").isNull()).isEqualTo(!v);
        assertThat(r.get("listingId").isNull()).isEqualTo(!l);
        rows.add(UUID.fromString(r.get("id").asText()));
        problem(request("POST", path(), owner, input(v, l)), 409);
      }
    assertThat(new HashSet<>(rows)).hasSize(4);
    var page = data(request("GET", path(), owner, null), 200);
    assertThat(page.get("items").size()).isEqualTo(4);
    assertThat(page.get("hasMore").asBoolean()).isFalse();
    assertThat(page.has("total")).isFalse();
    for (var row : rows) {
      request("DELETE", path() + "/" + row, owner, null).andExpect(status().isNoContent());
      problem(request("DELETE", path() + "/" + row, owner, null), 404);
    }
    actor(owner);
    var fresh = add(false, false);
    assertThat(rows).doesNotContain(fresh.id());
    assertThat(materials.readReference(material).status().name()).isEqualTo("ACTIVE");
    for (String table : List.of("material", "material_variant", "supplier_material_listing")) {
      var id =
          table.equals("material")
              ? material
              : table.equals("material_variant") ? variant : listing;
      assertThat(
              jdbc.sql("SELECT version FROM " + table + " WHERE id=:id")
                  .param("id", id)
                  .query(Long.class)
                  .single())
          .isZero();
    }
    assertThat(selectionAudits("material_selection.added")).isEqualTo(5);
    assertThat(selectionAudits("material_selection.removed")).isEqualTo(4);
  }

  @ParameterizedTest
  @ValueSource(strings = {"variant", "listing", "both", "variantWithListing", "listingWithVariant"})
  void mismatchesAre400(String kind) throws Exception {
    problem(
        request(
            "POST",
            path(),
            owner,
            new Input(
                material,
                kind.equals("listing")
                    ? null
                    : kind.equals("listingWithVariant") ? variant : otherVariant,
                kind.equals("variant")
                    ? null
                    : kind.equals("variantWithListing") ? listing : otherListing)),
        400);
    assertThat(selectionAudits("material_selection.added")).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"material", "variant", "listing"})
  void missingReferencesAre404(String kind) throws Exception {
    problem(
        request(
            "POST",
            path(),
            owner,
            new Input(
                kind.equals("material") ? id() : material,
                kind.equals("variant") ? id() : null,
                kind.equals("listing") ? id() : null)),
        404);
    assertThat(selectionAudits("material_selection.added")).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"DRAFT", "ARCHIVED", "variant", "listing"})
  void inactiveReferences409(String kind) throws Exception {
    catalogStatus(
        kind.equals("variant")
            ? "material_variant"
            : kind.equals("listing") ? "supplier_material_listing" : "material",
        kind.equals("variant") ? variant : kind.equals("listing") ? listing : material,
        kind.equals("DRAFT") ? "DRAFT" : "ARCHIVED");
    problem(request("POST", path(), owner, input(true, true)), 409);
    assertThat(selectionAudits("material_selection.added")).isZero();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"ORG_OWNER", "ORG_ADMIN", "VIEWER", "OUTSIDER", "REVOKED", "PLATFORM_ADMIN"})
  void authority(String role) throws Exception {
    var row = add(true, true);
    String sub =
        role.equals("ORG_OWNER")
            ? owner
            : role.equals("PLATFORM_ADMIN") ? admin() : "selection-" + id();
    if (Set.of("ORG_ADMIN", "VIEWER", "REVOKED").contains(role))
      membership(
          org,
          sub,
          role.equals("REVOKED") ? "ORG_ADMIN" : role,
          role.equals("REVOKED") ? "REVOKED" : "ACTIVE");
    boolean read = Set.of("ORG_OWNER", "ORG_ADMIN", "VIEWER").contains(role),
        write = Set.of("ORG_OWNER", "ORG_ADMIN").contains(role);
    request("GET", path(), sub, null).andExpect(status().is(read ? 200 : 403));
    request("POST", path(), sub, input(false, false)).andExpect(status().is(write ? 201 : 403));
    request("DELETE", path() + "/" + row.id(), sub, null).andExpect(status().is(write ? 204 : 403));
  }

  @Test
  void hierarchyBeforeChildAndArchiveReadOnlyAndRetainedCatalog() throws Exception {
    var row = add(true, true);
    var wrong = path().replace(project.id().toString(), foreignProject.id().toString());
    problem(request("GET", wrong, owner, null), 404);
    problem(request("POST", wrong, owner, input(false, false)), 404);
    problem(
        request(
            "DELETE",
            path().replace(style.id().toString(), foreignStyle.id().toString()) + "/" + row.id(),
            owner,
            null),
        404);
    actor(foreignOwner);
    var foreign =
        selections.add(
            foreignOrg, foreignProject.id(), foreignStyle.id(), input(false, false), "foreign");
    problem(request("DELETE", path() + "/" + foreign.id(), owner, null), 404);
    for (String table : List.of("material", "material_variant", "supplier_material_listing"))
      catalogStatus(
          table,
          table.equals("material")
              ? material
              : table.equals("material_variant") ? variant : listing,
          "ARCHIVED");
    actor(owner);
    assertThat(selections.list(org, project.id(), style.id(), 25, 0).items()).containsExactly(row);
    selections.remove(org, project.id(), style.id(), row.id(), "unlink");
    assertThat(materials.readReference(material).status().name()).isEqualTo("ARCHIVED");
    request("GET", path(), null, null).andExpect(status().isUnauthorized());
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void archivedParentAllowsListNotAddOrRemove(boolean parent) throws Exception {
    var row = add(false, false);
    if (parent)
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
    problem(request("POST", path(), owner, input(false, false)), 409);
    problem(request("DELETE", path() + "/" + row.id(), owner, null), 409);
  }

  @ParameterizedTest
  @ValueSource(strings = {"materialId", "variantId", "listingId"})
  void uuidTokensAreStrict(String field) throws Exception {
    for (Object bad : List.of("", "invalid", 1, true, List.of(), Map.of())) {
      var body = new LinkedHashMap<String, Object>(Map.of("materialId", material.toString()));
      body.put(field, bad);
      problem(request("POST", path(), owner, body), 400);
    }
    problem(request("POST", path(), owner, Map.of()), 400);
    problem(request("POST", path(), owner, Collections.singletonMap("materialId", null)), 400);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "id",
        "styleId",
        "projectId",
        "organizationId",
        "createdAt",
        "version",
        "status",
        "Actor",
        "supplierId",
        "price",
        "quantity"
      })
  void unknownFieldsRejected(String key) throws Exception {
    var b = new LinkedHashMap<String, Object>(Map.of("materialId", material));
    b.put(key, "foreign");
    problem(request("POST", path(), owner, b), 400);
  }

  @Test
  void paginationBoundsOrderingAndAuditRollback() throws Exception {
    for (int n = 0; n < 27; n++) {
      var m =
          catalog(
              jdbc.sql("SELECT catalog_supplier_id FROM material WHERE id=:id")
                  .param("id", material)
                  .query(UUID.class)
                  .single());
      selections.add(org, project.id(), style.id(), new Input(m, null, null), "page");
    }
    var page = selections.list(org, project.id(), style.id(), 25, 0);
    assertThat(page.items()).hasSize(25);
    assertThat(page.hasMore()).isTrue();
    assertThat(selections.list(org, project.id(), style.id(), 25, 25).items()).hasSize(2);
    assertThat(page.items())
        .isSortedAccordingTo(
            Comparator.comparing(
                    com.sourceos.stylematerialselection.StyleMaterialSelectionService.View
                        ::createdAt)
                .thenComparing(
                    com.sourceos.stylematerialselection.StyleMaterialSelectionService.View::id)
                .reversed());
    for (String q : List.of("limit=0", "limit=101", "offset=-1", "offset=100001"))
      problem(request("GET", path() + "?" + q, owner, null), 400);
    actor(owner);
    long before = selectionAudits("material_selection.added");
    assertThatThrownBy(
            () ->
                transaction()
                    .execute(
                        t -> {
                          add(true, true);
                          throw new IllegalStateException();
                        }))
        .isInstanceOf(IllegalStateException.class);
    assertThat(selectionAudits("material_selection.added")).isEqualTo(before);
    var row = add(true, true);
    assertThatThrownBy(
            () ->
                transaction()
                    .execute(
                        t -> {
                          selections.remove(org, project.id(), style.id(), row.id(), "rollback");
                          throw new IllegalStateException();
                        }))
        .isInstanceOf(IllegalStateException.class);
    assertThat(selections.list(org, project.id(), style.id(), 100, 0).items()).contains(row);
    var audit =
        jdbc.sql(
                "SELECT after_state::text FROM audit_event WHERE entity_id=:id AND"
                    + " action='material_selection.added'")
            .param("id", row.id())
            .query(String.class)
            .single();
    assertThat(json.readTree(audit).propertyNames())
        .containsExactlyInAnyOrder("styleId", "materialId", "variantId", "listingId");
  }

  @Test
  void catalogValidationOrderAndProviderFailures() throws Exception {
    catalogStatus("material", material, "DRAFT");
    problem(request("POST", path(), owner, new Input(material, id(), id())), 409);
    catalogStatus("material", material, "ACTIVE");
    for (var action :
        java.util.List.<Runnable>of(
            () -> materials.readReference(id()),
            () -> materials.readVariantReference(id()),
            () -> listings.readReference(id())))
      assertThatThrownBy(action::run)
          .isInstanceOfSatisfying(
              org.springframework.web.server.ResponseStatusException.class,
              e -> assertThat(e.getStatusCode().value()).isEqualTo(404));
    for (var action :
        java.util.List.<Runnable>of(
            () -> materials.lockActiveVariantReference(otherVariant, material),
            () -> listings.lockActiveReference(otherListing, material)))
      assertThatThrownBy(() -> transaction().executeWithoutResult(t -> action.run()))
          .isInstanceOfSatisfying(
              org.springframework.web.server.ResponseStatusException.class,
              e -> assertThat(e.getStatusCode().value()).isEqualTo(400));
    actor(owner);
    var before = new java.util.LinkedHashMap<String, Object>();
    for (String table :
        java.util.List.of("material", "material_variant", "supplier_material_listing"))
      before.put(
          table,
          jdbc.sql("SELECT id,status,version FROM " + table + " WHERE id=:id")
              .param(
                  "id",
                  table.equals("material")
                      ? material
                      : table.equals("material_variant") ? variant : listing)
              .query()
              .singleRow());
    var edge = add(true, true);
    selections.remove(org, project.id(), style.id(), edge.id(), "unlink");
    for (var entry : before.entrySet())
      assertThat(
              jdbc.sql("SELECT id,status,version FROM " + entry.getKey() + " WHERE id=:id")
                  .param(
                      "id",
                      entry.getKey().equals("material")
                          ? material
                          : entry.getKey().equals("material_variant") ? variant : listing)
                  .query()
                  .singleRow())
          .isEqualTo(entry.getValue());
    assertThat(styles.read(org, project.id(), style.id()).version()).isZero();
    assertThat(projects.read(org, project.id()).version()).isZero();
  }

  @Test
  void providerLocksRequireCallerTransactionsAndReadContractsAreImmutable() {
    assertThat(materials.readReference(material).materialId()).isEqualTo(material);
    assertThat(materials.readVariantReference(variant).materialId()).isEqualTo(material);
    assertThat(listings.readReference(listing).materialId()).isEqualTo(material);
    assertThatThrownBy(() -> materials.lockActiveReference(material))
        .isInstanceOf(IllegalTransactionStateException.class);
    assertThatThrownBy(() -> materials.lockActiveVariantReference(variant, material))
        .isInstanceOf(IllegalTransactionStateException.class);
    assertThatThrownBy(() -> listings.lockActiveReference(listing, material))
        .isInstanceOf(IllegalTransactionStateException.class);
    transaction()
        .executeWithoutResult(
            t -> {
              assertThat(materials.lockActiveReference(material))
                  .isEqualTo(materials.readReference(material));
              assertThat(materials.lockActiveVariantReference(variant, material))
                  .isEqualTo(materials.readVariantReference(variant));
              assertThat(listings.lockActiveReference(listing, material))
                  .isEqualTo(listings.readReference(listing));
            });
  }
}
