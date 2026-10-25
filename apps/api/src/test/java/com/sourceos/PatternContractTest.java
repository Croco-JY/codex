package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class PatternContractTest extends PatternSupport {
  @Test
  void sevenStableOperationsAndStrictPublicSchemas() throws Exception {
    var root =
        json.readTree(
            mvc.perform(MockMvcRequestBuilders.get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    String b =
        "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/patterns";
    var expected =
        Map.of(
            "GET " + b,
            "listPatterns",
            "POST " + b,
            "createPattern",
            "GET " + b + "/{patternId}",
            "readPattern",
            "PUT " + b + "/{patternId}",
            "updatePatternLifecycle",
            "GET " + b + "/{patternId}/revisions",
            "listPatternRevisions",
            "POST " + b + "/{patternId}/revisions",
            "createPatternRevision",
            "GET " + b + "/{patternId}/revisions/{revisionId}",
            "readPatternRevision");
    expected.forEach(
        (k, v) -> {
          var p = k.split(" ", 2);
          assertThat(
                  root.get("paths").get(p[1]).get(p[0].toLowerCase()).get("operationId").asString())
              .isEqualTo(v);
        });
    var schemas = root.at("/components/schemas");
    for (String n :
        List.of("PatternCreateInput", "PatternRevisionCreateInput", "PatternLifecycleInput"))
      assertThat(schemas.get(n).get("additionalProperties").asBoolean()).isFalse();
    for (String n : List.of("PatternRevisionView", "PatternRevisionSummary"))
      assertThat(schemas.get(n).get("properties").propertyNames())
          .containsExactlyInAnyOrder(
              "id",
              "patternId",
              "styleId",
              "revisionNumber",
              "name",
              "purpose",
              "measurementRevisionId",
              "createdAt");
  }

  @Test
  void providerDoesNotLockMeasurementOrLoadPoints() throws Exception {
    var m = create();
    actor(owner);
    transaction()
        .execute(
            t -> {
              var r =
                  measurements.referenceContext(
                      org, project.id(), style.id(), m.latestRevision().id());
              assertThat(r.revisionId()).isEqualTo(m.latestRevision().id());
              assertThat(
                      Arrays.stream(r.getClass().getRecordComponents())
                          .map(c -> c.getName())
                          .toList())
                  .containsExactly("revisionId", "measurementSpecId", "styleId", "revisionNumber");
              try (var c =
                      DriverManager.getConnection(
                          DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
                  var q = c.createStatement()) {
                c.setAutoCommit(false);
                assertThat(
                        q.executeQuery(
                                "SELECT id FROM measurement_spec WHERE id='"
                                    + m.id()
                                    + "' FOR UPDATE NOWAIT")
                            .next())
                    .isTrue();
                assertThat(
                        q.executeQuery(
                                "SELECT id FROM measurement_revision WHERE id='"
                                    + r.revisionId()
                                    + "' FOR UPDATE NOWAIT")
                            .next())
                    .isTrue();
                c.rollback();
              } catch (SQLException e) {
                throw new RuntimeException(e);
              }
              return null;
            });
  }
}
