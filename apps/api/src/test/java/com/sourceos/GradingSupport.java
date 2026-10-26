package com.sourceos;

import com.sourceos.grading.GradingModels.*;
import com.sourceos.grading.GradingService;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;

abstract class GradingSupport extends WorkspaceIntegrationSupport {
  @Autowired protected GradingService grading;

  String base() {
    return detail(true) + "/grade-rule-sets";
  }

  Map<String, Object> body() {
    return body(3, 2);
  }

  Map<String, Object> body(int sizeCount, int ruleCount) {
    var sizes = new ArrayList<Map<String, Object>>();
    for (int i = 0; i < sizeCount; i++)
      sizes.add(new LinkedHashMap<>(Map.of("code", "S" + i, "label", "Size " + i)));
    var rules = new ArrayList<Map<String, Object>>();
    for (int i = 0; i < ruleCount; i++) {
      var values = new ArrayList<Map<String, Object>>();
      for (int j = 0; j < sizeCount; j++)
        values.add(
            new LinkedHashMap<>(
                Map.of(
                    "sizeCode", "S" + j, "delta", j == 1 ? "-0.0000" : "-123456789012345.6789")));
      rules.add(
          new LinkedHashMap<>(
              Map.of(
                  "code",
                  "R" + i,
                  "label",
                  "Rule " + i,
                  "notes",
                  " Interior\nnotes ",
                  "values",
                  values)));
    }
    return new LinkedHashMap<>(
        Map.of(
            "name",
            " Core sizes ",
            "baseSizeCode",
            "S1",
            "unitSystem",
            "CM",
            "notes",
            " \u0085\ufeff ",
            "sizes",
            sizes,
            "rules",
            rules));
  }

  CreateInput input() {
    return json.convertValue(body(), CreateInput.class);
  }

  View grade() {
    actor(owner);
    return grading.create(org, project.id(), style.id(), input(), "grading-test");
  }

  RevisionInput next(long n) {
    var i = input();
    return new RevisionInput(
        n, "Next", i.baseSizeCode(), i.unitSystem(), i.notes(), i.sizes(), i.rules());
  }

  long gradingAudits() {
    return jdbc.sql(
            "SELECT count(*) FROM audit_event WHERE organization_id=:org AND entity_type IN"
                + " ('GradeRuleSet','GradeRuleSetRevision')")
        .param("org", org)
        .query(Long.class)
        .single();
  }

  int gradingCount(String table) {
    return jdbc.sql(
            "SELECT count(*) FROM "
                + table
                + " WHERE "
                + (table.equals("grade_rule_set") || table.equals("grade_rule_set_revision")
                    ? "style_id=:style"
                    : "revision_id IN (SELECT id FROM grade_rule_set_revision WHERE"
                        + " style_id=:style)"))
        .param("style", style.id())
        .query(Integer.class)
        .single();
  }
}
