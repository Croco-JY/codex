package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.sourceos.file.StoragePort;
import com.sourceos.styledevelopmentreference.StyleDevelopmentReferenceService;
import java.io.*;
import java.nio.file.NoSuchFileException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.*;
import org.springframework.test.util.AopTestUtils;

abstract class StyleDevelopmentReferenceSupport extends WorkspaceIntegrationSupport {
  @Autowired StyleDevelopmentReferenceService references;
  @MockitoBean StoragePort port;
  @MockitoSpyBean com.sourceos.audit.AuditRecorder recorder;
  final Map<String, byte[]> objects = new ConcurrentHashMap<>();

  interface Write {
    void accept(UUID org, UUID object, byte[] bytes) throws IOException;
  }

  Write writing;

  @BeforeEach
  void storage() throws Exception {
    objects.clear();
    writing = (o, k, b) -> objects.put(o + "/" + k, b.clone());
    doAnswer(
            a -> {
              writing.accept(a.getArgument(0), a.getArgument(1), a.getArgument(2));
              return null;
            })
        .when(port)
        .put(any(), any(), any());
    doAnswer(
            a -> {
              var b = objects.get(a.getArgument(0) + "/" + a.getArgument(1));
              if (b == null) throw new NoSuchFileException("synthetic-missing");
              return b;
            })
        .when(port)
        .get(any(), any());
  }

  String path() {
    return detail(true) + "/development-references";
  }

  StyleDevelopmentReferenceService.View upload() {
    actor(owner);
    return references.upload(
        org,
        project.id(),
        style.id(),
        "Synthetic reference",
        new byte[] {1, 2, 3},
        "upload-reference");
  }

  StyleDevelopmentReferenceService.View only() {
    actor(owner);
    var all = references.list(org, project.id(), style.id(), null, 25, 0).items();
    assertThat(all).hasSize(1);
    return all.getFirst();
  }

  long lifecycle(String action) {
    return jdbc.sql(
            "SELECT count(*) FROM audit_event WHERE organization_id=:org AND action=:action")
        .param("org", org)
        .param("action", "development_reference." + action)
        .query(Long.class)
        .single();
  }

  void state(String expected, long version) {
    assertThat(only().state().name()).isEqualTo(expected);
    assertThat(only().version()).isEqualTo(version);
  }

  void expectStatus(Runnable task, int code) {
    var thrown = catchThrowable(task::run);
    if (code == 403)
      assertThat(thrown)
          .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    else
      assertThat(thrown)
          .isInstanceOfSatisfying(
              org.springframework.web.server.ResponseStatusException.class,
              e -> assertThat(e.getStatusCode().value()).isEqualTo(code));
  }

  void archive(boolean styleParent) {
    actor(owner);
    try {
      data(
          request("PUT", detail(styleParent), owner, replacement(styleParent, "ARCHIVED", 0)), 200);
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
    actor(owner);
  }

  com.sourceos.audit.AuditRecorder auditTarget() {
    return AopTestUtils.getUltimateTargetObject(recorder);
  }

  void revoke() {
    jdbc.sql(
            "UPDATE membership SET status='REVOKED' WHERE organization_id=:org AND"
                + " subject=:subject")
        .param("org", org)
        .param("subject", owner)
        .update();
  }
}
