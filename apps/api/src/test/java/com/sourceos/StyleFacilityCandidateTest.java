package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.facility.FacilityService;
import com.sourceos.project.ProjectService;
import com.sourceos.style.StyleService;
import com.sourceos.stylefacilitycandidate.StyleFacilityCandidateService.Input;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.transaction.IllegalTransactionStateException;

class StyleFacilityCandidateTest extends StyleFacilityCandidateSupport {
  @Test
  void basicImmutableEdgeDuplicatesUnlinkReaddAndMinimalAudit() throws Exception {
    var empty = data(request("GET", path(), owner, null), 200);
    assertThat(empty.get("items").size()).isZero();
    assertThat(empty.has("total")).isFalse();
    var created = data(request("POST", path(), owner, input()), 201);
    assertThat(created.propertyNames())
        .containsExactlyInAnyOrder("id", "styleId", "facilityId", "createdAt");
    var edge = UUID.fromString(created.get("id").asText());
    problem(request("POST", path(), owner, input()), 409);
    assertThat(data(request("GET", path(), owner, null), 200).get("items").get(0))
        .isEqualTo(created);
    request("DELETE", path() + "/" + edge, owner, null).andExpect(status().isNoContent());
    problem(request("DELETE", path() + "/" + edge, owner, null), 404);
    assertThat(data(request("GET", path(), owner, null), 200).get("items").size()).isZero();
    actor(owner);
    assertThat(add().id()).isNotEqualTo(edge);
    assertThat(candidateAudits("facility_candidate.added")).isEqualTo(2);
    assertThat(candidateAudits("facility_candidate.removed")).isEqualTo(1);
    var states =
        jdbc.sql(
                "SELECT before_state::text,after_state::text,scope,actor_subject FROM audit_event"
                    + " WHERE entity_id=:id ORDER BY occurred_at")
            .param("id", edge)
            .query()
            .listOfRows();
    assertThat(states).hasSize(2);
    for (var state : states) {
      assertThat(state.get("scope")).isEqualTo("ORGANIZATION");
      assertThat(state.get("actor_subject")).isEqualTo(owner);
      for (String field : List.of("before_state", "after_state"))
        if (state.get(field) != null)
          assertThat(json.readTree(state.get(field).toString()).propertyNames())
              .containsExactlyInAnyOrder("styleId", "facilityId");
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"ACTIVE", "ARCHIVED"})
  void supplierLifecycleAndVerificationNeverGateRegistration(String lifecycle) throws Exception {
    catalogStatus("supplier_profile", supplier, lifecycle);
    for (String v :
        List.of("DISCOVERED", "CLAIMED", "VERIFIED", "AUDITED", "TRANSACTED", "PROVEN")) {
      jdbc.sql("UPDATE supplier_profile SET verification_status=:v WHERE id=:id")
          .param("v", v)
          .param("id", supplier)
          .update();
      var edge = data(request("POST", path(), owner, input()), 201);
      request("DELETE", path() + "/" + edge.get("id").asText(), owner, null)
          .andExpect(status().isNoContent());
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void missingOrArchivedFacility(boolean missing) throws Exception {
    if (!missing) catalogStatus("facility", facility, "ARCHIVED");
    problem(
        request("POST", path(), owner, new Input(missing ? id() : facility)), missing ? 404 : 409);
    assertThat(candidateAudits("facility_candidate.added")).isZero();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"ORG_OWNER", "ORG_ADMIN", "VIEWER", "OUTSIDER", "REVOKED", "PLATFORM_ADMIN"})
  void authority(String role) throws Exception {
    var edge = add();
    String sub =
        role.equals("ORG_OWNER")
            ? owner
            : role.equals("PLATFORM_ADMIN") ? admin() : "candidate-" + id();
    if (Set.of("ORG_ADMIN", "VIEWER", "REVOKED").contains(role))
      membership(
          org,
          sub,
          role.equals("REVOKED") ? "ORG_ADMIN" : role,
          role.equals("REVOKED") ? "REVOKED" : "ACTIVE");
    boolean read = Set.of("ORG_OWNER", "ORG_ADMIN", "VIEWER").contains(role),
        write = Set.of("ORG_OWNER", "ORG_ADMIN").contains(role);
    request("GET", path(), sub, null).andExpect(status().is(read ? 200 : 403));
    request("POST", path(), sub, new Input(otherFacility))
        .andExpect(status().is(write ? 201 : 403));
    request("DELETE", path() + "/" + edge.id(), sub, null)
        .andExpect(status().is(write ? 204 : 403));
  }

  @Test
  void hierarchyAndUnauthenticated() throws Exception {
    var edge = add();
    String wrong = path().replace(project.id().toString(), foreignProject.id().toString());
    for (String method : List.of("GET", "POST", "DELETE"))
      problem(
          request(
              method,
              wrong + (method.equals("DELETE") ? "/" + edge.id() : ""),
              owner,
              method.equals("POST") ? input() : null),
          404);
    problem(
        request(
            "DELETE",
            path().replace(style.id().toString(), foreignStyle.id().toString()) + "/" + edge.id(),
            owner,
            null),
        404);
    actor(foreignOwner);
    var foreign =
        candidates.add(foreignOrg, foreignProject.id(), foreignStyle.id(), input(), "foreign");
    problem(request("DELETE", path() + "/" + foreign.id(), owner, null), 404);
    request("GET", path(), null, null).andExpect(status().isUnauthorized());
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void archivedParentReadOnly(boolean p) throws Exception {
    var edge = add();
    if (p)
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
    problem(request("POST", path(), owner, new Input(otherFacility)), 409);
    problem(request("DELETE", path() + "/" + edge.id(), owner, null), 409);
    assertThat(candidateAudits("facility_candidate.removed")).isZero();
  }

  @Test
  void strictUuidAndUnknownProperties() throws Exception {
    for (Object bad : List.of("", "invalid", 1, true, List.of(), Map.of()))
      problem(request("POST", path(), owner, Map.of("facilityId", bad)), 400);
    problem(request("POST", path(), owner, Map.of()), 400);
    problem(request("POST", path(), owner, Collections.singletonMap("facilityId", null)), 400);
    for (String key :
        List.of(
            "id",
            "styleId",
            "projectId",
            "organizationId",
            "supplierId",
            "createdAt",
            "version",
            "status",
            "Actor",
            "capabilityId",
            "score")) {
      var body = new LinkedHashMap<String, Object>(Map.of("facilityId", facility));
      body.put(key, "foreign");
      problem(request("POST", path(), owner, body), 400);
    }
    assertThat(candidateAudits("facility_candidate.added")).isZero();
  }

  @Test
  void retentionAndCanonicalStateUnchanged() throws Exception {
    var before = canonical();
    var edge = add();
    candidates.remove(org, project.id(), style.id(), edge.id(), "unlink");
    assertThat(canonical()).isEqualTo(before);
    edge = add();
    catalogStatus("facility", facility, "ARCHIVED");
    catalogStatus("supplier_profile", supplier, "ARCHIVED");
    jdbc.sql("UPDATE supplier_profile SET verification_status='AUDITED' WHERE id=:id")
        .param("id", supplier)
        .update();
    assertThat(candidates.list(org, project.id(), style.id(), 25, 0).items()).containsExactly(edge);
    candidates.remove(org, project.id(), style.id(), edge.id(), "archived-unlink");
    assertThat(projects.read(org, project.id()).version()).isZero();
    assertThat(styles.read(org, project.id(), style.id()).version()).isZero();
  }

  Map<String, Object> canonical() {
    var m = new LinkedHashMap<String, Object>();
    m.put(
        "facility",
        jdbc.sql("SELECT row_to_json(f)::text FROM facility f WHERE id=:id")
            .param("id", facility)
            .query(String.class)
            .single());
    m.put(
        "supplier",
        jdbc.sql("SELECT row_to_json(s)::text FROM supplier_profile s WHERE id=:id")
            .param("id", supplier)
            .query(String.class)
            .single());
    m.put(
        "capabilities",
        jdbc.sql(
                "SELECT row_to_json(c)::text FROM facility_capability c WHERE facility_id=:id ORDER"
                    + " BY capability_id")
            .param("id", facility)
            .query(String.class)
            .list());
    return m;
  }

  @Test
  void paginationRollbackAndAuditSafety() throws Exception {
    for (int n = 0; n < 27; n++)
      candidates.add(org, project.id(), style.id(), new Input(facility()), "page");
    var page = candidates.list(org, project.id(), style.id(), 25, 0);
    assertThat(page.items()).hasSize(25);
    assertThat(page.hasMore()).isTrue();
    assertThat(candidates.list(org, project.id(), style.id(), 25, 25).items()).hasSize(2);
    assertThat(page.items())
        .isSortedAccordingTo(
            Comparator.comparing(
                    com.sourceos.stylefacilitycandidate.StyleFacilityCandidateService.View
                        ::createdAt)
                .thenComparing(
                    com.sourceos.stylefacilitycandidate.StyleFacilityCandidateService.View::id)
                .reversed());
    for (String q : List.of("limit=0", "limit=101", "offset=-1", "offset=100001"))
      problem(request("GET", path() + "?" + q, owner, null), 400);
    actor(owner);
    long count = candidateAudits("facility_candidate.added");
    assertThatThrownBy(
            () ->
                transaction()
                    .execute(
                        t -> {
                          add();
                          throw new IllegalStateException();
                        }))
        .isInstanceOf(IllegalStateException.class);
    assertThat(candidateAudits("facility_candidate.added")).isEqualTo(count);
    var edge = add();
    assertThatThrownBy(
            () ->
                transaction()
                    .execute(
                        t -> {
                          candidates.remove(org, project.id(), style.id(), edge.id(), "rollback");
                          throw new IllegalStateException();
                        }))
        .isInstanceOf(IllegalStateException.class);
    assertThat(candidates.list(org, project.id(), style.id(), 100, 0).items()).contains(edge);
    assertThat(candidateAudits("facility_candidate.removed")).isZero();
    assertThatThrownBy(
            () ->
                transaction()
                    .executeWithoutResult(
                        t ->
                            audit.organizationChanged(
                                org,
                                "bad",
                                "StyleFacilityCandidate",
                                id(),
                                "audit",
                                null,
                                Map.of("unsupported", facility))))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Unsupported audit field");
  }

  @Test
  void providerRequiresOuterTransaction() {
    assertThatThrownBy(() -> facilities.lockActiveReference(facility))
        .isInstanceOf(IllegalTransactionStateException.class);
    transaction()
        .executeWithoutResult(
            t ->
                assertThat(facilities.lockActiveReference(facility))
                    .isEqualTo(
                        new FacilityService.FacilityReference(
                            facility, supplier, FacilityService.Status.ACTIVE)));
  }
}
