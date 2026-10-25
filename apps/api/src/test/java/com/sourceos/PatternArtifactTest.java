package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;

class PatternArtifactTest extends PatternArtifactSupport {
  @Test
  void exactMetadataHeadersAndNoPublicPrivateFields() throws Exception {
    var r = upload();
    var v = data(request("GET", artifactPath(r.revision().id()), owner, null), 200);
    assertThat(v.propertyNames())
        .containsExactlyInAnyOrder(
            "id",
            "patternRevisionId",
            "patternId",
            "styleId",
            "declaredFormat",
            "displayName",
            "sizeBytes",
            "state",
            "failureCode",
            "createdAt",
            "updatedAt");
    assertThat(v.get("displayName").asString()).isEqualTo("자료 01.pdf");
    assertThat(v.get("failureCode").isNull()).isTrue();
    var response =
        request("GET", artifactPath(r.revision().id()) + "/content", owner, null)
            .andReturn()
            .getResponse();
    assertThat(response.getStatus()).isEqualTo(200);
    assertThat(response.getContentAsByteArray()).isEqualTo(pdf());
    assertThat(response.getContentType()).isEqualTo("application/octet-stream");
    assertThat(response.getHeader("Content-Disposition"))
        .startsWith("attachment;")
        .contains("UTF-8")
        .doesNotContain("\r", "\n");
    assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
    assertThat(response.getHeader("Cache-Control")).isEqualTo("private, no-store");
    actor(owner);
    var p = patterns.read(org, project.id(), style.id(), family.id());
    assertThat(p.version()).isEqualTo(family.version());
    assertThat(p.updatedAt()).isEqualTo(family.updatedAt());
    assertThat(projects.read(org, project.id()).version()).isZero();
    assertThat(styles.read(org, project.id(), style.id()).version()).isZero();
    for (String s :
        jdbc.sql(
                "SELECT after_state::text FROM audit_event WHERE organization_id=:org AND action"
                    + " LIKE 'pattern_artifact.%'")
            .param("org", org)
            .query(String.class)
            .list())
      assertThat(json.readTree(s).propertyNames())
          .doesNotContain(
              "displayName",
              "storageObjectId",
              "sha256",
              "name",
              "purpose",
              "createdByIssuer",
              "createdBySubject");
  }

  @ParameterizedTest
  @ValueSource(strings = {"OWNER", "ADMIN", "VIEWER", "PLATFORM", "FOREIGN", "NONE"})
  void metadataAndDownloadRoles(String role) throws Exception {
    var r = upload();
    String who =
        switch (role) {
          case "OWNER" -> owner;
          case "ADMIN", "VIEWER" -> {
            String w = "artifact-" + id();
            membership(org, w, role.equals("ADMIN") ? "ORG_ADMIN" : "VIEWER", "ACTIVE");
            yield w;
          }
          case "PLATFORM" -> admin();
          case "FOREIGN" -> foreignOwner;
          default -> null;
        };
    boolean allowed = Set.of("OWNER", "ADMIN", "VIEWER").contains(role);
    clearInvocations(port);
    for (String url :
        List.of(artifactPath(r.revision().id()), artifactPath(r.revision().id()) + "/content")) {
      if (allowed) request("GET", url, who, null).andExpect(status().isOk());
      else problem(request("GET", url, who, null), who == null ? 401 : 403);
    }
    if (!allowed) verifyNoInteractions(port);
  }

  @ParameterizedTest
  @ValueSource(strings = {"project", "style", "pattern"})
  void archivedHistoricalDownloadPersists(String parent) throws Exception {
    var r = upload();
    archive(parent);
    var response =
        request("GET", artifactPath(r.revision().id()) + "/content", owner, null)
            .andReturn()
            .getResponse();
    assertThat(response.getStatus()).isEqualTo(200);
    assertThat(response.getContentAsByteArray()).isEqualTo(pdf());
    assertThat(state()).isEqualTo("READY");
  }

  @ParameterizedTest
  @ValueSource(strings = {"missing", "length", "hash", "io"})
  void corruptedReadySendsNoArtifactBytesAndDoesNotMutate(String kind) throws Exception {
    var r = upload();
    if (kind.equals("missing")) objects.clear();
    else if (kind.equals("length")) objects.replaceAll((k, b) -> new byte[] {1});
    else if (kind.equals("hash"))
      objects.replaceAll(
          (k, b) -> {
            var x = b.clone();
            x[0] ^= 1;
            return x;
          });
    else
      reading =
          (o, k) -> {
            throw new IOException("synthetic unreadable");
          };
    var response =
        request("GET", artifactPath(r.revision().id()) + "/content", owner, null)
            .andReturn()
            .getResponse();
    assertThat(response.getStatus()).isEqualTo(409);
    assertThat(response.getContentType()).contains("application/problem+json");
    assertThat(response.getContentAsString()).doesNotContain("%PDF-", "synthetic unreadable");
    assertThat(state()).isEqualTo("READY");
    assertThat(events("ready")).isEqualTo(1);
  }

  @Test
  void artifactlessWrongHierarchyAndNoRawRoute() throws Exception {
    problem(request("GET", artifactPath(family.latestRevision().id()), owner, null), 404);
    var r = upload();
    clearInvocations(port);
    for (String url :
        List.of(
            artifactPath(r.revision().id()).replace(family.id().toString(), id().toString()),
            artifactPath(r.revision().id())
                .replace(style.id().toString(), foreignStyle.id().toString()),
            artifactPath(family.latestRevision().id()) + "/content",
            "/api/v1/pattern-artifacts/" + r.artifact().id()))
      problem(request("GET", url, owner, null), 404);
    verifyNoInteractions(port);
  }
}
