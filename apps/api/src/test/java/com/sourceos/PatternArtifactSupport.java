package com.sourceos;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.sourceos.file.StoragePort;
import com.sourceos.pattern.*;
import java.io.*;
import java.nio.file.NoSuchFileException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.*;

abstract class PatternArtifactSupport extends PatternSupport {
  @Autowired protected PatternArtifactService artifacts;
  @MockitoBean protected StoragePort port;
  @MockitoSpyBean protected com.sourceos.audit.AuditRecorder recorder;
  protected com.sourceos.pattern.PatternService.View family;
  final Map<String, byte[]> objects = new ConcurrentHashMap<>();

  interface Write {
    void accept(UUID org, UUID object, byte[] bytes) throws IOException;
  }

  interface Read {
    byte[] get(UUID org, UUID object) throws IOException;
  }

  Write writing;
  Read reading;

  static byte[] pdf() {
    return "%PDF-1.4\nsynthetic\n%%EOF\n".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
  }

  @BeforeEach
  void artifactFixture() throws Exception {
    family = pattern();
    objects.clear();
    writing =
        (o, k, b) -> {
          if (objects.putIfAbsent(o + "/" + k, b.clone()) != null)
            throw new IOException("synthetic existing object");
        };
    reading =
        (o, k) -> {
          var b = objects.get(o + "/" + k);
          if (b == null) throw new NoSuchFileException("synthetic missing");
          return b.clone();
        };
    doAnswer(
            a -> {
              writing.accept(a.getArgument(0), a.getArgument(1), a.getArgument(2));
              return null;
            })
        .when(port)
        .put(any(), any(), any());
    doAnswer(a -> reading.get(a.getArgument(0), a.getArgument(1))).when(port).get(any(), any());
  }

  PatternArtifactService.Input artifactInput() {
    return new PatternArtifactService.Input(
        1L,
        " Artifact revision ",
        " Purpose ",
        null,
        PatternArtifactProbe.Format.PDF,
        " 자료 01.pdf ");
  }

  PatternArtifactService.Result upload() {
    actor(owner);
    return artifacts.upload(
        org,
        project.id(),
        style.id(),
        family.id(),
        artifactInput(),
        () -> new ByteArrayInputStream(pdf()),
        "artifact-reference");
  }

  String uploadPath() {
    return base() + "/" + family.id() + "/artifact-revisions";
  }

  String artifactPath(UUID revision) {
    return base() + "/" + family.id() + "/revisions/" + revision + "/artifact";
  }

  long events(String action) {
    return jdbc.sql(
            "SELECT count(*) FROM audit_event WHERE organization_id=:org AND action=:action")
        .param("org", org)
        .param("action", "pattern_artifact." + action)
        .query(Long.class)
        .single();
  }

  String state() {
    return jdbc.sql("SELECT state FROM pattern_artifact WHERE style_id=:style")
        .param("style", style.id())
        .query(String.class)
        .single();
  }

  UUID revisionId() {
    return jdbc.sql("SELECT pattern_revision_id FROM pattern_artifact WHERE style_id=:style")
        .param("style", style.id())
        .query(UUID.class)
        .single();
  }

  void revoke() {
    jdbc.sql(
            "UPDATE membership SET status='REVOKED',version=version+1 WHERE organization_id=:org"
                + " AND subject=:who")
        .param("org", org)
        .param("who", owner)
        .update();
  }

  void archive(String parent) {
    actor(owner);
    try {
      if (parent.equals("pattern"))
        data(
            request(
                "PUT",
                base() + "/" + family.id(),
                owner,
                Map.of("status", "ARCHIVED", "version", 0)),
            200);
      else
        data(
            request(
                "PUT",
                detail(parent.equals("style")),
                owner,
                replacement(parent.equals("style"), "ARCHIVED", 0)),
            200);
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
    actor(owner);
  }
}
