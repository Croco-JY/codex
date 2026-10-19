package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.file.AuthorizedStorage;
import com.sourceos.identity.Actor;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class FoundationIntegrationTest {
  @Container static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18.3");

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
    r.add(
        "source.storage-root",
        () -> System.getProperty("java.io.tmpdir") + "/source-storage-" + UUID.randomUUID());
  }

  @Autowired MockMvc mvc;
  @Autowired JdbcClient jdbc;
  @Autowired AuthorizedStorage storage;

  String create(String actor) throws Exception {
    String body =
        mvc.perform(
                post("/api/organizations")
                    .header("X-Dev-Subject", actor)
                    .header("X-Request-ID", "foundation-test")
                    .contentType("application/json")
                    .content("{\"name\":\"Test organization\"}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return new tools.jackson.databind.ObjectMapper().readTree(body).get("id").asText();
  }

  @Test
  void migrationAndHealth() throws Exception {
    assertThat(
            jdbc.sql("SELECT count(*) FROM flyway_schema_history WHERE success")
                .query(Integer.class)
                .single())
        .isEqualTo(4);
    mvc.perform(get("/actuator/health/readiness"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("UP"));
    mvc.perform(get("/api/health")).andExpect(jsonPath("$.status").value("UP"));
  }

  @Test
  void membershipIsolationAndAudit() throws Exception {
    String id = create("owner");
    mvc.perform(get("/api/organizations/" + id).header("X-Dev-Subject", "owner"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.role").value("ORG_OWNER"));
    mvc.perform(get("/api/organizations/" + id).header("X-Dev-Subject", "outsider"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.requestId").exists());
    mvc.perform(get("/api/organizations").header("X-Dev-Subject", "outsider"))
        .andExpect(content().json("[]"));
    mvc.perform(
            patch("/api/organizations/" + id)
                .header("X-Dev-Subject", "owner")
                .header("X-Request-ID", "rename-test")
                .contentType("application/json")
                .content("{\"name\":\"Renamed\",\"version\":0}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(1));
    mvc.perform(
            patch("/api/organizations/" + id)
                .header("X-Dev-Subject", "owner")
                .contentType("application/json")
                .content("{\"name\":\"Stale\",\"version\":0}"))
        .andExpect(status().isConflict());
    var event =
        jdbc.sql(
                "SELECT actor_subject,action,request_id,occurred_at FROM audit_event WHERE"
                    + " organization_id=:id AND action='organization.renamed'")
            .param("id", UUID.fromString(id))
            .query()
            .singleRow();
    assertThat(event)
        .containsEntry("actor_subject", "owner")
        .containsEntry("request_id", "rename-test")
        .containsEntry("action", "organization.renamed");
    assertThat(event.get("occurred_at")).isNotNull();
    assertThatThrownBy(
            () ->
                jdbc.sql("DELETE FROM audit_event WHERE organization_id=:id")
                    .param("id", UUID.fromString(id))
                    .update())
        .hasMessageContaining("append-only");
    assertThatThrownBy(
            () ->
                jdbc.sql("UPDATE audit_event SET action='tampered' WHERE organization_id=:id")
                    .param("id", UUID.fromString(id))
                    .update())
        .hasMessageContaining("append-only");
    assertThatThrownBy(() -> jdbc.sql("TRUNCATE audit_event").update())
        .hasMessageContaining("append-only");
  }

  @Test
  void viewerCannotMutateAndRevokedMembershipDenied() throws Exception {
    String id = create("role-owner");
    jdbc.sql(
            "INSERT INTO membership(id,organization_id,issuer,subject,role)"
                + " VALUES(:id,:org,'urn:source-os:local','viewer','VIEWER')")
        .param("id", UUID.randomUUID())
        .param("org", UUID.fromString(id))
        .update();
    mvc.perform(get("/api/organizations/" + id).header("X-Dev-Subject", "viewer"))
        .andExpect(status().isOk());
    mvc.perform(
            patch("/api/organizations/" + id)
                .header("X-Dev-Subject", "viewer")
                .contentType("application/json")
                .content("{\"name\":\"Denied\",\"version\":0}"))
        .andExpect(status().isForbidden());
    jdbc.sql(
            "UPDATE membership SET status='REVOKED' WHERE organization_id=:org AND"
                + " subject='viewer'")
        .param("org", UUID.fromString(id))
        .update();
    mvc.perform(get("/api/organizations/" + id).header("X-Dev-Subject", "viewer"))
        .andExpect(status().isForbidden());
  }

  @Test
  void errorsAndAuthentication() throws Exception {
    mvc.perform(get("/api/identity"))
        .andExpect(status().isUnauthorized())
        .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
        .andExpect(jsonPath("$.requestId").exists());
    mvc.perform(
            post("/api/organizations")
                .header("X-Dev-Subject", "owner")
                .contentType("application/json")
                .content("{\"name\":\" \"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.requestId").exists());
    mvc.perform(get("/api/organizations/not-a-uuid").header("X-Dev-Subject", "owner"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.requestId").exists());
  }

  @Test
  void authorizedPrivateStorage() throws Exception {
    UUID org = UUID.fromString(create("storage-owner"));
    try {
      SecurityContextHolder.getContext()
          .setAuthentication(
              new UsernamePasswordAuthenticationToken(
                  new Actor("urn:source-os:local", "storage-owner"), null, List.of()));
      UUID key = storage.put(org, "private foundation".getBytes());
      assertThat(storage.get(org, key)).isEqualTo("private foundation".getBytes());
      SecurityContextHolder.getContext()
          .setAuthentication(
              new UsernamePasswordAuthenticationToken(
                  new Actor("urn:source-os:local", "intruder"), null, List.of()));
      assertThatThrownBy(() -> storage.get(org, key))
          .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    } finally {
      SecurityContextHolder.clearContext();
    }
  }

  @Test
  void openApiGeneratedFromBackend() throws Exception {
    mvc.perform(get("/v3/api-docs"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.paths['/api/organizations']").exists())
        .andExpect(jsonPath("$.components.schemas.OrganizationView").exists());
  }
}
