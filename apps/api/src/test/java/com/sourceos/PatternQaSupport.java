package com.sourceos;

import com.sourceos.patternqa.PatternQaModels.*;
import com.sourceos.patternqa.PatternQaService;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;

abstract class PatternQaSupport extends PatternArtifactSupport {
  @Autowired protected PatternQaService qa;

  String qaPath(UUID revision) {
    return base() + "/" + family.id() + "/revisions/" + revision + "/qa";
  }

  Input assessment(long head) {
    return new Input(head, Outcome.OBSERVED, Basis.METADATA_ONLY, null, " Human observation 🧵 ");
  }

  Map<String, Object> qaBody(long head) {
    var b = new LinkedHashMap<String, Object>();
    b.put("expectedLatestAssessmentNumber", head);
    b.put("outcome", "OBSERVED");
    b.put("evidenceBasis", "METADATA_ONLY");
    b.put("artifactId", null);
    b.put("notes", "Human observation");
    return b;
  }

  Assessment assess(long head) {
    actor(owner);
    return qa.create(
        org,
        project.id(),
        style.id(),
        family.id(),
        family.latestRevision().id(),
        assessment(head),
        "qa-test");
  }

  long qaAudits() {
    return jdbc.sql(
            "SELECT count(*) FROM audit_event WHERE organization_id=:org AND"
                + " action='pattern_qa.assessment_recorded'")
        .param("org", org)
        .query(Long.class)
        .single();
  }
}
