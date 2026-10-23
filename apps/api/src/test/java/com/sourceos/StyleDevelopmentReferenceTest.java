package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.AdditionalMatchers.aryEq;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.styledevelopmentreference.StyleDevelopmentReferenceService.State;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.http.ContentDisposition;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class StyleDevelopmentReferenceTest extends StyleDevelopmentReferenceSupport {
  @Test
  void uploadDownloadDetachAndNarrowAudit() throws Exception {
    var v = upload();
    state("READY", 1);
    assertThat(v.sizeBytes()).isEqualTo(3);
    assertThat(v.mediaType()).isEqualTo("application/octet-stream");
    assertThat(v.id()).isNotEqualTo(v.storageObjectId());
    verify(port).put(eq(org), eq(v.storageObjectId()), aryEq(new byte[] {1, 2, 3}));
    assertThat(lifecycle("upload_started")).isEqualTo(1);
    assertThat(lifecycle("ready")).isEqualTo(1);
    assertThat(
            jdbc.sql("SELECT DISTINCT request_id FROM audit_event WHERE entity_id=:id")
                .param("id", v.id())
                .query(String.class)
                .list())
        .containsExactly("upload-reference");
    assertThat(lifecycle("failed")).isZero();
    var audits =
        jdbc.sql(
                "SELECT after_state::text FROM audit_event WHERE entity_id=:id ORDER BY"
                    + " occurred_at,id")
            .param("id", v.id())
            .query(String.class)
            .list();
    for (var a : audits) {
      assertThat(json.readTree(a).propertyNames())
          .containsExactlyInAnyOrder("styleId", "state", "version", "sizeBytes");
      assertThat(a).doesNotContain(v.displayName(), v.storageObjectId().toString());
    }
    var content =
        request("GET", path() + "/" + v.id() + "/content", owner, null)
            .andExpect(status().isOk())
            .andExpect(content().bytes(new byte[] {1, 2, 3}));
    content
        .andExpect(header().string("Content-Type", "application/octet-stream"))
        .andExpect(header().string("X-Content-Type-Options", "nosniff"))
        .andExpect(header().string("Cache-Control", "private, no-store"));
    data(request("POST", path() + "/" + v.id() + "/detach", owner, Map.of("version", 1)), 200);
    state("DETACHED", 2);
    assertThat(objects).hasSize(1);
    assertThat(lifecycle("detached")).isEqualTo(1);
    problem(request("POST", path() + "/" + v.id() + "/detach", owner, Map.of("version", 2)), 409);
    problem(request("GET", path() + "/" + v.id() + "/content", owner, null), 409);
    actor(owner);
    assertThat(styles.read(org, project.id(), style.id()).version()).isZero();
    assertThat(projects.read(org, project.id()).version()).isZero();
  }

  @Test
  void emptyPageBoundsFilterAndNoBinaryFanout() throws Exception {
    data(request("GET", path(), owner, null), 200).get("items").isEmpty();
    upload();
    clearInvocations(port);
    for (String suffix :
        List.of("", "?state=READY", "?state=FAILED", "?state=PENDING", "?state=DETACHED"))
      data(request("GET", path() + suffix, owner, null), 200);
    data(request("GET", path() + "/" + only().id(), owner, null), 200);
    verifyNoInteractions(port);
    for (String suffix :
        List.of(
            "?state=NO",
            "?state=",
            "?state=READY&state=READY",
            "?state=READY,FAILED",
            "?limit=0",
            "?limit=101",
            "?offset=-1",
            "?offset=100001")) problem(request("GET", path() + suffix, owner, null), 400);
  }

  @Test
  void viewerAndPlatformAdminAndWrongHierarchy() throws Exception {
    var v = upload();
    String viewer = "viewer-" + id();
    membership(org, viewer, "VIEWER", "ACTIVE");
    data(request("GET", path(), viewer, null), 200);
    data(request("GET", path() + "/" + v.id(), viewer, null), 200);
    request("GET", path() + "/" + v.id() + "/content", viewer, null).andExpect(status().isOk());
    problem(request("POST", path() + "/" + v.id() + "/detach", viewer, Map.of("version", 1)), 403);
    String platform = admin();
    problem(request("GET", path(), platform, null), 403);
    problem(request("GET", path() + "/" + v.id() + "/content", platform, null), 403);
    problem(
        request(
            "GET",
            path().replace(style.id().toString(), foreignStyle.id().toString()),
            owner,
            null),
        404);
    problem(
        request(
            "GET",
            path().replace(project.id().toString(), foreignProject.id().toString()),
            owner,
            null),
        404);
    problem(
        request("GET", path().replace(org.toString(), foreignOrg.toString()), owner, null), 403);
    problem(request("GET", path() + "/" + id(), owner, null), 404);
    request("GET", "/api/v1/storage/" + v.storageObjectId(), owner, null)
        .andExpect(status().isNotFound());
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void archivedParentsPermitReadAndDownloadOnly(boolean parentStyle) throws Exception {
    var v = upload();
    archive(parentStyle);
    data(request("GET", path(), owner, null), 200);
    request("GET", path() + "/" + v.id() + "/content", owner, null).andExpect(status().isOk());
    problem(request("POST", path() + "/" + v.id() + "/detach", owner, Map.of("version", 1)), 409);
    actor(owner);
    expectStatus(this::upload, 409);
    assertThat(objects).hasSize(1);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "{}",
        "{\"version\":null}",
        "{\"version\":\"1\"}",
        "{\"version\":0.5}",
        "{\"version\":-1}",
        "{\"version\":9007199254740992}",
        "{\"version\":9223372036854775808}",
        "{\"version\":0,\"styleId\":\"x\"}"
      })
  void strictDetachInput(String body) throws Exception {
    var v = upload();
    mvc.perform(
            MockMvcRequestBuilders.post(path() + "/" + v.id() + "/detach")
                .header("X-Dev-Subject", owner)
                .header("X-Request-ID", "workspace-reference")
                .contentType("application/json")
                .content(body))
        .andExpect(status().isBadRequest());
    state("READY", 1);
    assertThat(lifecycle("detached")).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"sample file.bin", "샘플 자료 01", "sample (1).bin", "quoted-name'01.bin"})
  void safeUtf8AttachmentHeaders(String name) throws Exception {
    actor(owner);
    var v = references.upload(org, project.id(), style.id(), name, new byte[] {1}, "utf8");
    var response =
        request("GET", path() + "/" + v.id() + "/content", owner, null)
            .andExpect(status().isOk())
            .andReturn()
            .getResponse();
    String h = response.getHeader("Content-Disposition");
    assertThat(h)
        .startsWith("attachment;")
        .contains("filename*=UTF-8''")
        .doesNotContain("\r", "\n");
    assertThat(ContentDisposition.parse(h).getFilename()).isEqualTo(name);
    assertThat(response.getContentType()).isEqualTo("application/octet-stream");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "   ",
        ".",
        "..",
        "../secret",
        "..\\secret",
        "/etc/passwd",
        "C:\\secret",
        "line\nbreak",
        "line\rbreak",
        "a\u0001b"
      })
  void unsafeNamesNeverReserve(String name) {
    actor(owner);
    expectStatus(
        () -> references.upload(org, project.id(), style.id(), name, new byte[] {1}, "invalid"),
        400);
    assertThat(lifecycle("upload_started")).isZero();
    verifyNoInteractions(port);
  }

  @Test
  void longNameAndZeroBytesNeverReserve() {
    actor(owner);
    expectStatus(
        () ->
            references.upload(
                org, project.id(), style.id(), "a".repeat(256), new byte[] {1}, "invalid"),
        400);
    expectStatus(
        () -> references.upload(org, project.id(), style.id(), "valid", new byte[0], "empty"), 400);
    assertThat(lifecycle("upload_started")).isZero();
    verifyNoInteractions(port);
  }

  @Test
  void missingBytesAndLengthMismatchFailSafeWithoutStateMutation() throws Exception {
    var v = upload();
    objects.clear();
    problem(request("GET", path() + "/" + v.id() + "/content", owner, null), 404);
    objects.put(org + "/" + v.storageObjectId(), new byte[] {1, 2});
    problem(request("GET", path() + "/" + v.id() + "/content", owner, null), 409);
    state("READY", 1);
  }

  @Test
  void paginationAllStatesStableOrdering() {
    for (int n = 0; n < 27; n++) upload();
    actor(owner);
    var page = references.list(org, project.id(), style.id(), null, 25, 0);
    assertThat(page.items()).hasSize(25);
    assertThat(page.hasMore()).isTrue();
    var rest = references.list(org, project.id(), style.id(), null, 25, 25);
    assertThat(rest.items()).hasSize(2);
    assertThat(rest.hasMore()).isFalse();
    assertThat(page.items()).doesNotContainAnyElementsOf(rest.items());
    assertThat(page.items())
        .isSortedAccordingTo(
            Comparator.comparing(
                    com.sourceos.styledevelopmentreference.StyleDevelopmentReferenceService.View
                        ::createdAt)
                .thenComparing(v -> v.id().toString())
                .reversed());
  }

  @ParameterizedTest
  @EnumSource(
      value = State.class,
      names = {"PENDING", "FAILED", "DETACHED"})
  void eachNonReadyStateBlocksStorageProbe(State wanted) throws Exception {
    if (wanted == State.PENDING) {
      writing =
          (o, k, b) -> {
            throw new AssertionError("synthetic interruption");
          };
      assertThatThrownBy(this::upload).isInstanceOf(AssertionError.class);
    } else if (wanted == State.FAILED) {
      writing =
          (o, k, b) -> {
            throw new java.io.IOException("synthetic IO failure");
          };
      expectStatus(this::upload, 500);
    } else {
      var v = upload();
      references.detach(org, project.id(), style.id(), v.id(), 1, "detach");
    }
    var v = only();
    assertThat(v.state()).isEqualTo(wanted);
    clearInvocations(port);
    data(request("GET", path() + "/" + v.id(), owner, null), 200);
    problem(request("GET", path() + "/" + v.id() + "/content", owner, null), 409);
    verifyNoInteractions(port);
  }

  @Test
  void foreignReferenceIsNotResolvedThroughAuthorizedValidHierarchy() throws Exception {
    actor(foreignOwner);
    var v =
        references.upload(
            foreignOrg,
            foreignProject.id(),
            foreignStyle.id(),
            "Synthetic foreign file",
            new byte[] {1},
            "foreign");
    clearInvocations(port);
    problem(request("GET", path() + "/" + v.id(), owner, null), 404);
    problem(request("GET", path() + "/" + v.id() + "/content", owner, null), 404);
    problem(request("POST", path() + "/" + v.id() + "/detach", owner, Map.of("version", 1)), 404);
    verifyNoInteractions(port);
    assertThat(auditCount(v.id())).isEqualTo(2);
  }
}
