package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class MeasurementContractTest extends MeasurementSupport {
  @Test
  void fiveStableOperationsStrictInputsAndPrivatePublicBoundary() throws Exception {
    var root =
        json.readTree(
            mvc.perform(MockMvcRequestBuilders.get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    String p =
        "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/measurement-spec";
    assertThat(root.at("/paths/" + p.replace("/", "~1") + "/get/operationId").asString())
        .isEqualTo("readMeasurementSpec");
    assertThat(root.get("paths").get(p).get("put").get("operationId").asString())
        .isEqualTo("createMeasurementSpec");
    assertThat(root.get("paths").get(p + "/revisions").get("get").get("operationId").asString())
        .isEqualTo("listMeasurementRevisions");
    assertThat(root.get("paths").get(p + "/revisions").get("post").get("operationId").asString())
        .isEqualTo("createMeasurementRevision");
    assertThat(
            root.get("paths")
                .get(p + "/revisions/{revisionId}")
                .get("get")
                .get("operationId")
                .asString())
        .isEqualTo("readMeasurementRevision");
    var schemas = root.at("/components/schemas");
    for (String name :
        List.of(
            "MeasurementSpecCreateInput",
            "MeasurementRevisionCreateInput",
            "MeasurementPointInput"))
      assertThat(schemas.get(name).get("additionalProperties").asBoolean()).isFalse();
    assertThat(schemas.get("MeasurementRevisionView").get("properties").propertyNames())
        .containsExactlyInAnyOrder(
            "id",
            "measurementSpecId",
            "styleId",
            "revisionNumber",
            "baseSize",
            "unitSystem",
            "createdAt",
            "points");
    assertThat(
            schemas
                .get("MeasurementPointView")
                .get("required")
                .valueStream()
                .map(n -> n.asString())
                .toList())
        .contains("tolerancePlus", "toleranceMinus", "notes");
  }

  @Test
  void optionalNullsArePresentAndFiveHundredApiRowsAreComplete() throws Exception {
    var b = body();
    var points = new ArrayList<Map<String, Object>>();
    for (int i = 0; i < 500; i++)
      points.add(Map.of("code", "POM/" + i, "label", "Point " + i, "value", "0.0000"));
    b.put("points", points);
    var r = data(put(b, owner, "*"), 201).get("latestRevision");
    assertThat(r.get("points")).hasSize(500);
    var p = r.get("points").get(0);
    for (String field : List.of("tolerancePlus", "toleranceMinus", "notes"))
      assertThat(p.get(field).isNull()).isTrue();
    assertThat(r.get("points").get(499).get("position").asInt()).isEqualTo(499);
  }
}
