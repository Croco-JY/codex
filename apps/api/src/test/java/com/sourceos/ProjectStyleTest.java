package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.project.ProjectService;
import com.sourceos.style.StyleService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.transaction.IllegalTransactionStateException;

class ProjectStyleTest extends WorkspaceIntegrationSupport {
  enum Role {
    OWNER,
    ADMIN,
    VIEWER,
    OUTSIDER,
    REVOKED,
    PLATFORM_ADMIN
  }

  @Test
  void authenticationAndRouteBoundariesRemainClosed() throws Exception {
    for (boolean child : List.of(false, true)) {
      problem(request("GET", collection(child), null, null), 401);
      problem(request("GET", detail(child), null, null), 401);
      problem(request("POST", collection(child), null, Map.of("name", "Denied")), 401);
      problem(request("PUT", detail(child), null, replacement(child, "ACTIVE", 0)), 401);
      problem(request("DELETE", detail(child), owner, null), 405);
    }
    for (String path :
        List.of(
            "/api/v1/projects", "/api/v1/projects/" + project.id(), "/api/v1/styles/" + style.id()))
      problem(request("GET", path, owner, null), 404);
  }

  @ParameterizedTest
  @EnumSource(Role.class)
  void organizationPolicyProtectsAllEightOperations(Role role) throws Exception {
    String subject = role == Role.PLATFORM_ADMIN ? admin() : "role-" + id();
    if (role != Role.PLATFORM_ADMIN && role != Role.OUTSIDER)
      membership(
          org,
          subject,
          role == Role.VIEWER ? "VIEWER" : role == Role.ADMIN ? "ORG_ADMIN" : "ORG_OWNER",
          role == Role.REVOKED ? "REVOKED" : "ACTIVE");
    boolean read = Set.of(Role.OWNER, Role.ADMIN, Role.VIEWER).contains(role);
    boolean write = Set.of(Role.OWNER, Role.ADMIN).contains(role);
    for (boolean child : List.of(false, true)) {
      if (read) {
        data(request("GET", collection(child), subject, null), 200);
        data(request("GET", detail(child), subject, null), 200);
      } else {
        problem(request("GET", collection(child), subject, null), 403);
        problem(request("GET", detail(child), subject, null), 403);
        problem(request("GET", collection(child) + "/" + id(), subject, null), 403);
      }
      if (write) {
        data(
            request("POST", collection(child), subject, Map.of("name", "Created by tenant writer")),
            201);
        data(request("PUT", detail(child), subject, replacement(child, "ACTIVE", 0)), 200);
      } else {
        problem(request("POST", collection(child), subject, Map.of("name", "Denied")), 403);
        problem(request("PUT", detail(child), subject, replacement(child, "ACTIVE", 0)), 403);
      }
    }
  }

  @Test
  void tenantAndNestedLookupReturn404OnlyAfterRequestedOrganizationPermission() throws Exception {
    String root = "/api/v1/organizations/" + org + "/projects/";
    for (String method : List.of("GET", "PUT")) {
      Object body = method.equals("PUT") ? replacement(false, "ACTIVE", 0) : null;
      var response = request(method, root + foreignProject.id(), owner, body);
      problem(response, 404);
      assertThat(response.andReturn().getResponse().getContentAsString())
          .doesNotContain("Foreign private", foreignOrg.toString(), "SQL", "constraint");
      problem(request(method, root + id(), owner, body), 404);
      problem(
          request(
              method,
              "/api/v1/organizations/" + foreignOrg + "/projects/" + foreignProject.id(),
              owner,
              body),
          403);
    }
    actor(owner);
    var other =
        projects.create(org, new ProjectService.CreateInput("Another parent", null), "fixture");
    for (UUID wrongStyle : List.of(style.id(), foreignStyle.id(), id())) {
      String wrongPath = root + other.id() + "/styles/" + wrongStyle;
      problem(request("GET", wrongPath, owner, null), 404);
      problem(request("PUT", wrongPath, owner, replacement(true, "ACTIVE", 0)), 404);
    }
    actor(owner);
    projects.update(
        org,
        other.id(),
        new ProjectService.UpdateInput(other.name(), null, ProjectService.Status.ARCHIVED, 0L),
        "fixture");
    // Hierarchy404 wins over the archived parent409; no foreign Style inspection.
    problem(
        request(
            "PUT",
            root + other.id() + "/styles/" + foreignStyle.id(),
            owner,
            replacement(true, "ACTIVE", 0)),
        404);
    problem(request("GET", root + foreignProject.id() + "/styles", owner, null), 404);
    problem(
        request(
            "POST", root + foreignProject.id() + "/styles", owner, Map.of("name", "Wrong parent")),
        404);
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void normalizedCreateReplacementLifecycleAndVersions(boolean child) throws Exception {
    var create = new LinkedHashMap<String, Object>();
    create.put("name", "  Canonical name  ");
    create.put("description", "  \t  ");
    if (child) create.put("styleCode", "  MiXeD-01  ");
    var first = data(request("POST", collection(child), owner, create), 201);
    UUID id = UUID.fromString(first.path("id").asText());
    String path = collection(child) + "/" + id;
    assertThat(first.path("name").asText()).isEqualTo("Canonical name");
    assertThat(first.path("description").isNull()).isTrue();
    assertThat(first.path("status").asText()).isEqualTo("ACTIVE");
    assertThat(first.path("version").asLong()).isZero();
    assertThat(first.path(child ? "projectId" : "organizationId").asText())
        .isEqualTo((child ? project.id() : org).toString());
    assertThat(first.path("createdAt").asText()).endsWith("Z");
    assertThat(first.path("updatedAt").asText()).endsWith("Z");
    if (child) {
      assertThat(first.path("styleCode").asText()).isEqualTo("MiXeD-01");
      data(request("POST", collection(true), owner, create), 201); // Codes deliberately not unique.
    }
    var body = new LinkedHashMap<String, Object>();
    body.put("name", "Canonical name");
    body.put("status", "ACTIVE");
    body.put("version", 0);
    if (child) body.put("styleCode", "MiXeD-01");
    var identical = data(request("PUT", path, owner, body), 200);
    assertThat(identical.path("version").asLong()).isEqualTo(1);
    assertThat(identical.path("createdAt")).isEqualTo(first.path("createdAt"));
    long audits = auditCount(id);
    problem(request("PUT", path, owner, body), 409);
    assertThat(auditCount(id)).isEqualTo(audits);
    body.put("version", 1);
    body.put("name", "Changed");
    body.put("description", " private changed description ");
    if (child) body.put("styleCode", " ");
    var edited = data(request("PUT", path, owner, body), 200);
    assertThat(edited.path("description").asText()).isEqualTo("private changed description");
    if (child) assertThat(edited.path("styleCode").isNull()).isTrue();
    body.put("version", 2);
    body.put("status", "ARCHIVED");
    body.put("name", "Mixed forbidden edit");
    problem(request("PUT", path, owner, body), 400);
    assertThat(auditCount(id)).isEqualTo(audits + 1);
    body.put("name", " Changed ");
    var archived = data(request("PUT", path, owner, body), 200);
    assertThat(archived.path("version").asLong()).isEqualTo(3);
    assertThat(data(request("GET", path, owner, null), 200)).isEqualTo(archived);
    body.put("version", 3);
    problem(request("PUT", path, owner, body), 409);
    body.put("status", "ACTIVE");
    body.put("description", "Different reactivation");
    problem(request("PUT", path, owner, body), 400);
    body.put("description", "private changed description");
    assertThat(data(request("PUT", path, owner, body), 200).path("version").asLong()).isEqualTo(4);
    assertThat(auditCount(id)).isEqualTo(audits + 3);
    String prefix = child ? "style." : "project.";
    assertThat(
            jdbc.sql("SELECT action FROM audit_event WHERE entity_id=:id")
                .param("id", id)
                .query(String.class)
                .list())
        .containsExactlyInAnyOrder(
            prefix + "created",
            prefix + "updated",
            prefix + "updated",
            prefix + "archived",
            prefix + "reactivated");
    if (child) {
      actor(owner);
      assertThat(projects.read(org, project.id()).version()).isZero();
    }
  }

  @Test
  void archivedProjectBlocksEveryStyleWriteWithoutCascadingStatuses() throws Exception {
    data(request("PUT", detail(true), owner, replacement(true, "ARCHIVED", 0)), 200);
    data(request("PUT", detail(false), owner, replacement(false, "ARCHIVED", 0)), 200);
    long before = auditCount(style.id());
    for (String status : List.of("ACTIVE", "ARCHIVED"))
      problem(request("PUT", detail(true), owner, replacement(true, status, 1)), 409);
    problem(request("POST", collection(true), owner, Map.of("name", "Blocked")), 409);
    assertThat(data(request("GET", detail(true), owner, null), 200).path("status").asText())
        .isEqualTo("ARCHIVED");
    data(request("GET", collection(true), owner, null), 200);
    data(request("PUT", detail(false), owner, replacement(false, "ACTIVE", 1)), 200);
    assertThat(data(request("GET", detail(true), owner, null), 200).path("status").asText())
        .isEqualTo("ARCHIVED");
    assertThat(auditCount(style.id())).isEqualTo(before);
    assertThat(
            data(request("PUT", detail(true), owner, replacement(true, "ACTIVE", 1)), 200)
                .path("version")
                .asLong())
        .isEqualTo(2);
    actor(owner);
    assertThat(projects.read(org, project.id()).version()).isEqualTo(2);
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void strictInputsRejectMissingUnsafeVersionUnknownOwnershipAndInvalidText(boolean child)
      throws Exception {
    for (Object invalid : List.of("", "   ", "x".repeat(161), 123, true, List.of("name")))
      problem(request("POST", collection(child), owner, Map.of("name", invalid)), 400);
    problem(request("POST", collection(child), owner, Map.of()), 400);
    problem(
        request(
            "POST",
            collection(child),
            owner,
            Map.of("name", "Valid", "description", "x".repeat(4001))),
        400);
    for (String key :
        List.of("id", "organizationId", "projectId", "actorIssuer", "status", "version"))
      problem(
          request("POST", collection(child), owner, Map.of("name", "Valid", key, "forbidden")),
          400);
    var base = replacement(child, "ACTIVE", 0);
    for (Object invalid : List.of(-1, "0", 0.5, "invalid", Long.MAX_VALUE + "0")) {
      var body = new LinkedHashMap<>(base);
      body.put("version", invalid);
      problem(request("PUT", detail(child), owner, body), 400);
    }
    for (String key : List.of("version", "status", "name")) {
      var body = new LinkedHashMap<>(base);
      body.remove(key);
      problem(request("PUT", detail(child), owner, body), 400);
      body.put(key, null);
      problem(request("PUT", detail(child), owner, body), 400);
    }
    for (Object invalid : List.of("DELETED", 0, 1, true)) {
      var body = new LinkedHashMap<>(base);
      body.put("status", invalid);
      problem(request("PUT", detail(child), owner, body), 400);
    }
    var body = new LinkedHashMap<>(base);
    body.put("organizationId", foreignOrg);
    problem(request("PUT", detail(child), owner, body), 400);
    var limit = new LinkedHashMap<String, Object>();
    limit.put("name", "n".repeat(160));
    limit.put("description", "d".repeat(4000));
    if (child) limit.put("styleCode", "C".repeat(100));
    data(request("POST", collection(child), owner, limit), 201);
    if (child) {
      limit.put("styleCode", "C".repeat(101));
      problem(request("POST", collection(true), owner, limit), 400);
    }
  }

  @Test
  void contextsPreserveBothLifecycleStatesAndRequireCallerTransactionsForLocks() {
    actor(owner);
    projects.update(
        org,
        project.id(),
        new ProjectService.UpdateInput(
            project.name(), project.description(), ProjectService.Status.ARCHIVED, 0L),
        "context-test");
    var pc = projects.readContext(org, project.id());
    var sc = styles.readContext(org, project.id(), style.id());
    assertThat(pc.status()).isEqualTo(ProjectService.Status.ARCHIVED);
    assertThat(sc.projectStatus()).isEqualTo(ProjectService.Status.ARCHIVED);
    assertThat(sc.styleStatus()).isEqualTo(StyleService.Status.ACTIVE);
    assertThat(sc.organizationId()).isEqualTo(org);
    assertThat(sc.projectId()).isEqualTo(project.id());
    assertThat(sc.styleId()).isEqualTo(style.id());
    assertThatThrownBy(() -> projects.lockContextForWrite(org, project.id()))
        .isInstanceOf(IllegalTransactionStateException.class);
    assertThatThrownBy(() -> styles.lockContextForWrite(org, project.id(), style.id()))
        .isInstanceOf(IllegalTransactionStateException.class);
    transaction()
        .executeWithoutResult(
            s -> {
              assertThat(projects.lockContextForWrite(org, project.id())).isEqualTo(pc);
              assertThat(styles.lockContextForWrite(org, project.id(), style.id())).isEqualTo(sc);
            });
  }
}
