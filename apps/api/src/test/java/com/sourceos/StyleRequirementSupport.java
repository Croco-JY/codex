package com.sourceos;

import com.sourceos.stylerequirement.StyleRequirementService;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

abstract class StyleRequirementSupport extends WorkspaceIntegrationSupport {
  @Autowired protected StyleRequirementService requirements;

  String path() {
    return detail(true) + "/requirement";
  }

  Map<String, Object> body(long version) {
    return new LinkedHashMap<>(Map.of("version", version));
  }

  StyleRequirementService.Input input(long version, String product) {
    return new StyleRequirementService.Input(product, null, null, null, null, null, null, version);
  }

  StyleRequirementService.View create() {
    return requirements
        .write(org, project.id(), style.id(), input(0, "Original"), "*", "requirement-reference")
        .view();
  }

  ResultActions put(Object body, String subject, Object... header) throws Exception {
    var r =
        MockMvcRequestBuilders.put(path())
            .header("X-Dev-Subject", subject)
            .header("X-Request-ID", "workspace-reference")
            .contentType("application/json")
            .content(json.writeValueAsString(body));
    if (header.length > 0) r.header("If-None-Match", header);
    return mvc.perform(r);
  }

  long requirementAudits() {
    return jdbc.sql(
            "SELECT count(*) FROM audit_event WHERE entity_type='StyleRequirement' AND"
                + " entity_id=:id")
        .param("id", style.id())
        .query(Long.class)
        .single();
  }
}
