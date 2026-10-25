package com.sourceos;

import com.sourceos.pattern.PatternService;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;

abstract class PatternSupport extends MeasurementSupport {
  @Autowired protected PatternService patterns;

  String base() {
    return detail(true) + "/patterns";
  }

  Map<String, Object> patternBody() {
    return new LinkedHashMap<>(Map.of("name", " Main Pattern ", "purpose", " Main family "));
  }

  PatternService.View pattern() {
    actor(owner);
    return patterns.create(
        org,
        project.id(),
        style.id(),
        new PatternService.CreateInput("Main Pattern", "Main family", null),
        "pattern-test");
  }

  PatternService.RevisionInput next(long n) {
    return new PatternService.RevisionInput(n, "Next Pattern", null, null);
  }

  long patternAudits() {
    return jdbc.sql(
            "SELECT count(*) FROM audit_event WHERE organization_id=:org AND entity_type IN"
                + " ('Pattern','PatternRevision')")
        .param("org", org)
        .query(Long.class)
        .single();
  }

  int patternCount(String table) {
    return jdbc.sql("SELECT count(*) FROM " + table + " WHERE style_id=:style")
        .param("style", style.id())
        .query(Integer.class)
        .single();
  }
}
