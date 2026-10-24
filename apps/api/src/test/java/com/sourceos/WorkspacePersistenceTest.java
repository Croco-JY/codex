package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.transaction.IllegalTransactionStateException;

class WorkspacePersistenceTest extends WorkspaceIntegrationSupport {
  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void boundedPagesStatusFiltersAndDeterministicOrdering(boolean child) throws Exception {
    UUID scope = organization(owner), parent = id();
    if (child)
      jdbc.sql("INSERT INTO project(id,organization_id,name) VALUES(:id,:org,'Page parent')")
          .param("id", parent)
          .param("org", scope)
          .update();
    var ids = new ArrayList<UUID>();
    for (int i = 0; i < 105; i++) {
      UUID id = id();
      ids.add(id);
      String table = child ? "style" : "project",
          ownerColumn = child ? "project_id" : "organization_id";
      jdbc.sql(
              "INSERT INTO "
                  + table
                  + "(id,"
                  + ownerColumn
                  + ",name,status,created_at)"
                  + " VALUES(:id,:parent,'Page fixture',:status,:time)")
          .param("id", id)
          .param("parent", child ? parent : scope)
          .param("status", i < 80 ? "ACTIVE" : "ARCHIVED")
          .param("time", Timestamp.from(Instant.parse("2025-01-01T00:00:00Z").plusMillis(i)))
          .update();
    }
    String path =
        "/api/v1/organizations/" + scope + "/projects" + (child ? "/" + parent + "/styles" : "");
    var page = data(request("GET", path, owner, null), 200);
    assertThat(page.path("items").size()).isEqualTo(25);
    assertThat(page.path("limit").asInt()).isEqualTo(25);
    assertThat(page.path("offset").asInt()).isZero();
    assertThat(page.path("hasMore").asBoolean()).isTrue();
    assertThat(page.has("total")).isFalse();
    for (int i = 0; i < 25; i++)
      assertThat(page.path("items").get(i).path("id").asText())
          .isEqualTo(ids.get(104 - i).toString());
    var last = data(request("GET", path + "?limit=100&offset=5", owner, null), 200);
    assertThat(last.path("items").size()).isEqualTo(100);
    assertThat(last.path("hasMore").asBoolean()).isFalse();
    assertThat(data(request("GET", path + "?limit=1", owner, null), 200).path("items").size())
        .isEqualTo(1);
    assertThat(data(request("GET", path + "?offset=105", owner, null), 200).path("items").size())
        .isZero();
    for (String status : List.of("ACTIVE", "ARCHIVED")) {
      var filtered =
          data(request("GET", path + "?status=" + status + "&limit=100", owner, null), 200);
      assertThat(filtered.path("items").size()).isEqualTo(status.equals("ACTIVE") ? 80 : 25);
      for (var item : filtered.path("items"))
        assertThat(item.path("status").asText()).isEqualTo(status);
    }
    for (String query :
        List.of(
            "limit=0", "limit=101", "offset=-1", "offset=100001", "status=UNKNOWN", "limit=bad"))
      problem(request("GET", path + "?" + query, owner, null), 400);
    // Equal timestamps use the descending UUID tie breaker, independently of insertion order.
    UUID high = new UUID(id().getMostSignificantBits(), 2),
        low = new UUID(high.getMostSignificantBits(), 1);
    String table = child ? "style" : "project",
        ownerColumn = child ? "project_id" : "organization_id";
    for (UUID id : List.of(high, low))
      jdbc.sql(
              "INSERT INTO "
                  + table
                  + "(id,"
                  + ownerColumn
                  + ",name,created_at)"
                  + " VALUES(:id,:parent,'Tie fixture','2030-01-01T00:00:00Z')")
          .param("id", id)
          .param("parent", child ? parent : scope)
          .update();
    var ties = data(request("GET", path + "?limit=2", owner, null), 200).path("items");
    assertThat(ties.get(0).path("id").asText()).isEqualTo(high.toString());
    assertThat(ties.get(1).path("id").asText()).isEqualTo(low.toString());
  }

  @Test
  void directDatabaseIdentityDestructionAndOptionalTextBackstopsRecoverEveryFailure()
      throws Exception {
    try (var c = DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword())) {
      c.setAutoCommit(false);
      try (var q = c.createStatement()) {
        var identity =
            List.of(
                "UPDATE project SET id=gen_random_uuid() WHERE id='" + project.id() + "'",
                "UPDATE project SET organization_id='"
                    + foreignOrg
                    + "' WHERE id='"
                    + project.id()
                    + "'",
                "UPDATE project SET created_at=created_at+interval '1 second' WHERE id='"
                    + project.id()
                    + "'",
                "UPDATE style SET id=gen_random_uuid() WHERE id='" + style.id() + "'",
                "UPDATE style SET project_id='"
                    + foreignProject.id()
                    + "' WHERE id='"
                    + style.id()
                    + "'",
                "UPDATE style SET created_at=created_at+interval '1 second' WHERE id='"
                    + style.id()
                    + "'");
        for (String sql : identity) {
          var savepoint = c.setSavepoint();
          assertThatThrownBy(() -> q.execute(sql))
              .isInstanceOf(SQLException.class)
              .hasMessageContaining("identity is immutable");
          c.rollback(savepoint);
        }
        for (String sql :
            List.of(
                "DELETE FROM project WHERE id='" + project.id() + "'",
                "DELETE FROM style WHERE id='" + style.id() + "'",
                "TRUNCATE style CASCADE",
                // Include referencing tables so PostgreSQL's FK precheck cannot mask the intended
                // guard.
                "TRUNCATE project CASCADE")) {
          var savepoint = c.setSavepoint();
          assertThatThrownBy(() -> q.execute(sql))
              .isInstanceOf(SQLException.class)
              .hasMessageContaining("Workspace rows cannot be deleted or truncated");
          c.rollback(savepoint);
        }
        for (boolean child : List.of(false, true)) {
          String table = child ? "style" : "project",
              id = (child ? style.id() : project.id()).toString();
          for (String field :
              child
                  ? List.of("name", "description", "style_code")
                  : List.of("name", "description")) {
            for (String blank : List.of("", "   ")) {
              var savepoint = c.setSavepoint();
              assertThatThrownBy(
                      () ->
                          q.execute(
                              "UPDATE "
                                  + table
                                  + " SET "
                                  + field
                                  + "='"
                                  + blank
                                  + "' WHERE id='"
                                  + id
                                  + "'"))
                  .isInstanceOf(SQLException.class)
                  .hasMessageContaining("check constraint");
              c.rollback(savepoint);
            }
          }
          for (String expression : List.of("status='DELETED'", "version=-1")) {
            var savepoint = c.setSavepoint();
            assertThatThrownBy(
                    () ->
                        q.execute(
                            "UPDATE " + table + " SET " + expression + " WHERE id='" + id + "'"))
                .isInstanceOf(SQLException.class)
                .hasMessageContaining("check constraint");
            c.rollback(savepoint);
          }
          assertThat(
                  q.executeUpdate(
                      "UPDATE "
                          + table
                          + " SET description=NULL"
                          + (child ? ",style_code=NULL" : "")
                          + " WHERE id='"
                          + id
                          + "'"))
              .isEqualTo(1);
        }
        assertThat(q.executeQuery("SELECT 1").next())
            .isTrue(); // Connection is usable, not aborted.
      } finally {
        c.rollback();
      }
    }
    actor(owner);
    assertThat(projects.read(org, project.id()).description()).isEqualTo(project.description());
    assertThat(styles.read(org, project.id(), style.id()).styleCode()).isEqualTo(style.styleCode());
  }

  @Test
  void auditUsesTenantActorTargetRequestAndMinimalStateNotPrivateMetadata() throws Exception {
    data(request("PUT", detail(false), owner, replacement(false, "ACTIVE", 0)), 200);
    data(request("PUT", detail(true), owner, replacement(true, "ACTIVE", 0)), 200);
    var rows =
        jdbc.sql(
                "SELECT"
                    + " scope,organization_id,actor_issuer,actor_subject,entity_type,entity_id,action,request_id,before_state::text"
                    + " AS before_state,after_state::text AS after_state FROM audit_event WHERE"
                    + " entity_id IN (:p,:s) ORDER BY occurred_at,id")
            .param("p", project.id())
            .param("s", style.id())
            .query()
            .listOfRows();
    assertThat(rows).hasSize(4);
    for (var row : rows) {
      assertThat(row.get("scope")).isEqualTo("ORGANIZATION");
      assertThat(row.get("organization_id")).isEqualTo(org);
      assertThat(row.get("actor_issuer")).isEqualTo("urn:source-os:local");
      assertThat(row.get("actor_subject")).isEqualTo(owner);
      String target = row.get("entity_type").toString();
      assertThat(target).isIn("Project", "Style");
      assertThat(row.get("entity_id"))
          .isEqualTo(target.equals("Project") ? project.id() : style.id());
      assertThat(row.get("action"))
          .isIn("project.created", "style.created", "project.updated", "style.updated");
      if (row.get("action").toString().endsWith("updated")) {
        assertThat(row.get("request_id")).isEqualTo("workspace-reference");
        assertThat(row.get("before_state")).isNotNull();
      }
      String state = Objects.toString(row.get("before_state"), "") + row.get("after_state");
      assertThat(state)
          .doesNotContain("description", "Private", "name", "styleCode", "request", "actor");
      var fields = new HashSet<String>();
      json.readTree(row.get("after_state").toString()).propertyNames().forEach(fields::add);
      assertThat(fields).isSubsetOf("projectId", "styleId", "status", "version");
    }
  }

  @Test
  void businessAndAuditRollbackTogetherIncludingAuditValidationFailure() {
    actor(owner);
    long pAudits = auditCount(project.id()), sAudits = auditCount(style.id());
    assertThatThrownBy(
            () ->
                transaction()
                    .executeWithoutResult(
                        tx -> {
                          projects.update(
                              org,
                              project.id(),
                              new com.sourceos.project.ProjectService.UpdateInput(
                                  "Rolled back",
                                  null,
                                  com.sourceos.project.ProjectService.Status.ACTIVE,
                                  0L),
                              "rollback-reference");
                          styles.update(
                              org,
                              project.id(),
                              style.id(),
                              new com.sourceos.style.StyleService.UpdateInput(
                                  null,
                                  "Rolled back",
                                  null,
                                  com.sourceos.style.StyleService.Status.ACTIVE,
                                  0L),
                              "rollback-reference");
                          throw new IllegalStateException("Forced rollback");
                        }))
        .isInstanceOf(IllegalStateException.class);
    assertThat(projects.read(org, project.id())).isEqualTo(project);
    assertThat(styles.read(org, project.id(), style.id())).isEqualTo(style);
    assertThat(auditCount(project.id())).isEqualTo(pAudits);
    assertThat(auditCount(style.id())).isEqualTo(sAudits);
    for (Map<String, ?> bad :
        List.of(
            Map.of("description", "Forbidden audit text"),
            Map.of("projectId", Map.of("nested", "object")))) {
      assertThatThrownBy(
              () ->
                  transaction()
                      .executeWithoutResult(
                          tx -> {
                            projects.update(
                                org,
                                project.id(),
                                new com.sourceos.project.ProjectService.UpdateInput(
                                    "Must roll back",
                                    null,
                                    com.sourceos.project.ProjectService.Status.ACTIVE,
                                    0L),
                                "rollback-reference");
                            audit.organizationChanged(
                                org,
                                "project.updated",
                                "Project",
                                project.id(),
                                "rollback-reference",
                                null,
                                bad);
                          }))
          .isInstanceOf(IllegalArgumentException.class);
      assertThat(projects.read(org, project.id())).isEqualTo(project);
      assertThat(auditCount(project.id())).isEqualTo(pAudits);
    }
    assertThatThrownBy(
            () ->
                audit.organizationChanged(
                    org,
                    "project.updated",
                    "Project",
                    project.id(),
                    "outside-tx",
                    null,
                    Map.of("status", "ACTIVE")))
        .isInstanceOf(IllegalTransactionStateException.class);
  }
}
