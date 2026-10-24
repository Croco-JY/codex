package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class PhaseTwoCumulativeSecurityTest extends PhaseTwoCumulativeSupport {
  String subject(String role) {
    return switch (role) {
      case "OWNER" -> owner;
      case "ADMIN" -> administrator;
      case "VIEWER" -> viewer;
      case "B" -> foreignOwner;
      case "PLATFORM" -> platform;
      default -> stranger;
    };
  }

  @ParameterizedTest
  @ValueSource(strings = {"OWNER", "ADMIN", "VIEWER", "B", "PLATFORM", "NONE"})
  void allPrivateReadLayersEnforceRequestedOrganizationBeforeLookup(String role) throws Exception {
    boolean member = Set.of("OWNER", "ADMIN", "VIEWER").contains(role);
    for (String url : reads()) {
      var response = request("GET", url, subject(role), null);
      if (member) response.andExpect(status().isOk());
      else problem(response, 403);
    }
    assertThat(audits()).isEqualTo(7);
  }

  @ParameterizedTest
  @ValueSource(strings = {"OWNER", "ADMIN", "VIEWER", "B", "PLATFORM", "NONE"})
  void childWriteMatrixAndAuditActorAreCumulative(String role) throws Exception {
    boolean writer = Set.of("OWNER", "ADMIN").contains(role);
    var before = children();
    long auditBefore = audits();
    var globals = supply();
    for (var c : childCommands()) {
      var response = request(c.method(), c.url(), subject(role), c.body());
      if (writer) response.andExpect(status().is(c.success()));
      else problem(response, 403);
    }
    if (writer) multipart(subject(role)).andExpect(status().isCreated());
    else problem(multipart(subject(role)), 403);
    if (!writer) {
      assertThat(children()).isEqualTo(before);
      assertThat(audits()).isEqualTo(auditBefore);
    } else {
      var rows =
          jdbc.sql(
                  "SELECT actor_subject,organization_id,scope FROM audit_event WHERE"
                      + " organization_id=:org AND request_id='workspace-reference'")
              .param("org", org)
              .query()
              .listOfRows();
      assertThat(rows).hasSize(8);
      rows.forEach(
          r -> {
            assertThat(r.get("actor_subject")).isEqualTo(subject(role));
            assertThat(r.get("organization_id")).isEqualTo(org);
            assertThat(r.get("scope")).isEqualTo("ORGANIZATION");
          });
    }
    assertThat(supply()).isEqualTo(globals);
    actor(owner);
    assertThat(projects.read(org, project.id()).version()).isZero();
    assertThat(styles.read(org, project.id(), style.id()).version()).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"OWNER", "ADMIN", "VIEWER"})
  void projectAndStyleCreationMetadataAndLifecycleMatrix(String role) throws Exception {
    boolean writer = !role.equals("VIEWER");
    String subject = subject(role);
    long before = audits();
    var creates =
        List.of(
            new Command(
                "POST", collection(false), Map.of("name", "Synthetic additional Project"), 201),
            new Command(
                "POST", collection(true), Map.of("name", "Synthetic additional Style"), 201));
    for (var c : creates) {
      var r = request(c.method(), c.url(), subject, c.body());
      if (writer) r.andExpect(status().isCreated());
      else problem(r, 403);
    }
    for (boolean isStyle : List.of(false, true))
      for (int n = 0; n < 3; n++) {
        String status = n == 1 ? "ARCHIVED" : "ACTIVE";
        var r =
            request("PUT", detail(isStyle), subject, replacement(isStyle, status, writer ? n : 0));
        if (writer) r.andExpect(status().isOk());
        else problem(r, 403);
      }
    if (!writer) assertThat(audits()).isEqualTo(before);
  }

  @Test
  void authorizedWrongHierarchyAndForeignChildAreExactly404WithoutLeakingFacts() throws Exception {
    for (String wrong :
        List.of(
            root().replace(project.id().toString(), foreignProject.id().toString()),
            root().replace(style.id().toString(), foreignStyle.id().toString())))
      for (String suffix :
          List.of(
              "",
              "/requirement",
              "/material-selections",
              "/facility-candidates",
              "/development-references")) problem(request("GET", wrong + suffix, owner, null), 404);
    for (String suffix :
        List.of("/" + foreignReference.id(), "/" + foreignReference.id() + "/content")) {
      var r = request("GET", path() + suffix, owner, null);
      problem(r, 404);
      assertThat(r.andReturn().getResponse().getContentAsString())
          .doesNotContain("Synthetic foreign", foreignReference.storageObjectId().toString());
    }
    problem(
        request("DELETE", root() + "/material-selections/" + foreignSelection, owner, null), 404);
    problem(
        request("DELETE", root() + "/facility-candidates/" + foreignCandidate, owner, null), 404);
    problem(
        request(
            "POST", path() + "/" + foreignReference.id() + "/detach", owner, Map.of("version", 1)),
        404);
    var foreignRoot =
        root()
            .replace(org.toString(), foreignOrg.toString())
            .replace(project.id().toString(), foreignProject.id().toString())
            .replace(style.id().toString(), foreignStyle.id().toString());
    problem(request("GET", foreignRoot, owner, null), 403);
    problem(request("GET", root(), foreignOwner, null), 403);
    assertThat(audits()).isEqualTo(7);
  }

  @Test
  void committedRevocationDeniesEveryLaterReadAndWriteBoundary() throws Exception {
    var before = children();
    var globals = supply();
    long count = audits();
    revoke();
    for (String url : reads()) problem(request("GET", url, owner, null), 403);
    for (var c : childCommands()) problem(request(c.method(), c.url(), owner, c.body()), 403);
    problem(multipart(owner), 403);
    for (boolean isStyle : List.of(false, true))
      problem(request("PUT", detail(isStyle), owner, replacement(isStyle, "ACTIVE", 0)), 403);
    assertThat(children()).isEqualTo(before);
    assertThat(audits()).isEqualTo(count);
    assertThat(supply()).isEqualTo(globals);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void parentArchiveReadWriteReactivationHasNoDescendantCascade(boolean isStyle) throws Exception {
    var before = children();
    var globals = supply();
    data(request("PUT", detail(isStyle), owner, replacement(isStyle, "ARCHIVED", 0)), 200);
    assertThat(children()).isEqualTo(before);
    long count = audits();
    for (String url : reads()) request("GET", url, owner, null).andExpect(status().isOk());
    for (var c : childCommands()) problem(request(c.method(), c.url(), owner, c.body()), 409);
    problem(multipart(owner), 409);
    assertThat(children()).isEqualTo(before);
    assertThat(audits()).isEqualTo(count);
    data(request("PUT", detail(isStyle), owner, replacement(isStyle, "ACTIVE", 1)), 200);
    assertThat(children()).isEqualTo(before);
    assertThat(supply()).isEqualTo(globals);
    assertThat(audits()).isEqualTo(count + 1);
  }

  @Test
  void missingPrivateIdsStillAuthorizeRequestedOrganizationFirst() throws Exception {
    for (String role : List.of("B", "PLATFORM", "NONE"))
      for (String url : reads()) {
        String absent =
            url.replace(project.id().toString(), id().toString())
                .replace(style.id().toString(), id().toString())
                .replace(reference.id().toString(), id().toString());
        problem(request("GET", absent, subject(role), null), 403);
      }
    for (String url : reads()) problem(request("GET", url, null, null), 401);
    assertThat(audits()).isEqualTo(7);
  }

  @Test
  void problemDetailsAndRejectedCorrelationIdsNeverExposePrivatePayloads() throws Exception {
    problem(
        request(
            "PUT",
            root() + "/requirement",
            owner,
            Map.of("version", -1, "notes", "Synthetic private body marker")),
        400);
    problem(request("PUT", root() + "/requirement", owner, Map.of("version", 9)), 409);
    mvc.perform(
            MockMvcRequestBuilders.put(root() + "/requirement")
                .header("X-Dev-Subject", owner)
                .header("X-Request-ID", "workspace-reference")
                .header("If-None-Match", "*")
                .contentType("application/json")
                .content("{\"version\":0}"))
        .andExpect(status().isPreconditionFailed())
        .andExpect(jsonPath("$.requestId").value("workspace-reference"));
    writing =
        (o, k, b) -> {
          throw new java.io.IOException("Synthetic private path /tmp/private-marker SQL marker");
        };
    var failure = multipart(owner);
    problem(failure, 500);
    String body = failure.andReturn().getResponse().getContentAsString();
    assertThat(body)
        .doesNotContain(
            "/tmp/",
            "SQL marker",
            "IOException",
            "Synthetic cumulative upload",
            "Synthetic private body marker");
    var safe =
        mvc.perform(
                MockMvcRequestBuilders.post(collection(false))
                    .header("X-Dev-Subject", owner)
                    .header("X-Request-ID", "bad\r\ninjected-header")
                    .contentType("application/json")
                    .content("{\"name\":\"Synthetic correlation fixture\"}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse();
    String correlation = safe.getHeader("X-Request-ID");
    assertThat(correlation).matches("[A-Za-z0-9_-]{1,64}").doesNotContain("bad", "\r", "\n");
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM audit_event WHERE organization_id=:org AND"
                        + " request_id=:request")
                .param("org", org)
                .param("request", correlation)
                .query(Integer.class)
                .single())
        .isEqualTo(1);
    assertThat(lifecycle("upload_started")).isEqualTo(2);
    assertThat(lifecycle("failed")).isEqualTo(1);
    assertThat(lifecycle("ready")).isEqualTo(1);
  }
}
