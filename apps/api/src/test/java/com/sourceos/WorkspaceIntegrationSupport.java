package com.sourceos;

import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.project.ProjectService;
import com.sourceos.style.StyleService;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Unique fixture identities, never destructive cleanup or trigger bypasses. */
abstract class WorkspaceIntegrationSupport extends SupplyIntegrationSupport {
  @Autowired protected ProjectService projects;
  @Autowired protected StyleService styles;
  @Autowired protected AuditRecorder audit;
  @Autowired protected JsonMapper json;
  @Autowired protected PlatformTransactionManager transactions;
  protected String owner, foreignOwner;
  protected UUID org, foreignOrg;
  protected ProjectService.View project, foreignProject;
  protected StyleService.View style, foreignStyle;

  @BeforeEach
  void workspaceFixture() {
    owner = "workspace-" + id();
    foreignOwner = "workspace-" + id();
    org = organization(owner);
    foreignOrg = organization(foreignOwner);
    actor(owner);
    project =
        projects.create(
            org,
            new ProjectService.CreateInput("Private project", "Private project description"),
            "workspace-fixture");
    style =
        styles.create(
            org,
            project.id(),
            new StyleService.CreateInput("MixedCase", "Private style", "Private style description"),
            "workspace-fixture");
    actor(foreignOwner);
    foreignProject =
        projects.create(
            foreignOrg,
            new ProjectService.CreateInput("Foreign private name", null),
            "workspace-fixture");
    foreignStyle =
        styles.create(
            foreignOrg,
            foreignProject.id(),
            new StyleService.CreateInput(null, "Foreign private style", null),
            "workspace-fixture");
    actor(owner);
  }

  UUID organization(String subject) {
    UUID organization = id();
    jdbc.sql("INSERT INTO organization(id,name) VALUES(:id,'Synthetic private workspace')")
        .param("id", organization)
        .update();
    membership(organization, subject, "ORG_OWNER", "ACTIVE");
    return organization;
  }

  void membership(UUID organization, String subject, String role, String status) {
    jdbc.sql(
            "INSERT INTO membership(id,organization_id,issuer,subject,role,status)"
                + " VALUES(:id,:org,'urn:source-os:local',:subject,:role,:status)")
        .param("id", id())
        .param("org", organization)
        .param("subject", subject)
        .param("role", role)
        .param("status", status)
        .update();
  }

  String collection(boolean isStyle) {
    return "/api/v1/organizations/"
        + org
        + "/projects"
        + (isStyle ? "/" + project.id() + "/styles" : "");
  }

  String detail(boolean isStyle) {
    return collection(isStyle) + "/" + (isStyle ? style.id() : project.id());
  }

  Map<String, Object> replacement(boolean isStyle, String status, long version) {
    var body = new LinkedHashMap<String, Object>();
    body.put("name", isStyle ? style.name() : project.name());
    body.put("description", isStyle ? style.description() : project.description());
    if (isStyle) body.put("styleCode", style.styleCode());
    body.put("status", status);
    body.put("version", version);
    return body;
  }

  ResultActions request(String method, String path, String subject, Object body) throws Exception {
    var request =
        MockMvcRequestBuilders.request(HttpMethod.valueOf(method), path)
            .header("X-Request-ID", "workspace-reference");
    if (subject != null) request.header("X-Dev-Subject", subject);
    if (body != null)
      request.contentType("application/json").content(json.writeValueAsString(body));
    return mvc.perform(request);
  }

  JsonNode data(ResultActions result, int status) throws Exception {
    return json.readTree(
        result.andExpect(status().is(status)).andReturn().getResponse().getContentAsString());
  }

  void problem(ResultActions result, int code) throws Exception {
    result
        .andExpect(status().is(code))
        .andExpect(jsonPath("$.status").value(code))
        .andExpect(jsonPath("$.requestId").value("workspace-reference"))
        .andExpect(header().string("X-Request-ID", "workspace-reference"));
  }

  long auditCount(UUID entity) {
    return jdbc.sql("SELECT count(*) FROM audit_event WHERE entity_id=:id")
        .param("id", entity)
        .query(Long.class)
        .single();
  }

  TransactionTemplate transaction() {
    return new TransactionTemplate(transactions);
  }
}
