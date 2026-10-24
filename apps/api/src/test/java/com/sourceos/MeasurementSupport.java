package com.sourceos;

import com.sourceos.measurement.MeasurementService;
import java.math.BigDecimal;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

abstract class MeasurementSupport extends WorkspaceIntegrationSupport {
  @Autowired protected MeasurementService measurements;

  String path() {
    return detail(true) + "/measurement-spec";
  }

  Map<String, Object> point() {
    return new LinkedHashMap<>(
        Map.of(
            "code",
            "CHEST",
            "label",
            " Chest ",
            "value",
            "00012.5",
            "tolerancePlus",
            "1",
            "toleranceMinus",
            "0.5",
            "notes",
            "  synthetic\nPOM note  "));
  }

  Map<String, Object> body() {
    return new LinkedHashMap<>(
        Map.of("baseSize", " M ", "unitSystem", "CM", "points", List.of(point())));
  }

  Map<String, Object> revisionBody(long n) {
    var b = body();
    b.put("expectedLatestRevisionNumber", n);
    return b;
  }

  MeasurementService.CreateInput input() {
    return new MeasurementService.CreateInput(
        " M ",
        MeasurementService.UnitSystem.CM,
        List.of(
            new MeasurementService.PointInput(
                "CHEST", " Chest ", new BigDecimal("12.5"), BigDecimal.ONE, null, " note ")));
  }

  MeasurementService.SpecView create() {
    actor(owner);
    return measurements.create(
        org, project.id(), style.id(), input(), List.of("*"), "measurement-test");
  }

  MeasurementService.RevisionInput revision(long n) {
    var i = input();
    return new MeasurementService.RevisionInput(n, i.baseSize(), i.unitSystem(), i.points());
  }

  ResultActions put(Object body, String who, Object... header) throws Exception {
    var r =
        MockMvcRequestBuilders.put(path())
            .header("X-Request-ID", "workspace-reference")
            .contentType("application/json")
            .content(json.writeValueAsString(body));
    if (who != null) r.header("X-Dev-Subject", who);
    if (header.length > 0) r.header("If-None-Match", header);
    return mvc.perform(r);
  }

  long audits() {
    return jdbc.sql(
            "SELECT count(*) FROM audit_event WHERE organization_id=:org AND entity_type IN"
                + " ('MeasurementSpec','MeasurementRevision')")
        .param("org", org)
        .query(Long.class)
        .single();
  }

  int count(String table) {
    return jdbc.sql(
            "SELECT count(*) FROM "
                + table
                + " WHERE "
                + (table.equals("measurement_point")
                    ? "measurement_revision_id IN (SELECT id FROM measurement_revision WHERE"
                          + " style_id=:style)"
                    : "style_id=:style"))
        .param("style", style.id())
        .query(Integer.class)
        .single();
  }
}
