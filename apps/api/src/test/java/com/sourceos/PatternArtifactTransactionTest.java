package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.*;
import java.sql.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.util.AopTestUtils;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

class PatternArtifactTransactionTest extends PatternArtifactSupport {
  void status(Runnable r, int code) {
    if (code == 403) assertThatThrownBy(r::run).isInstanceOf(AccessDeniedException.class);
    else
      assertThatThrownBy(r::run)
          .isInstanceOfSatisfying(
              ResponseStatusException.class,
              e -> assertThat(e.getStatusCode().value()).isEqualTo(code));
  }

  com.sourceos.audit.AuditRecorder auditTarget() {
    return AopTestUtils.getUltimateTargetObject(recorder);
  }

  @Test
  void reservationCommittedAndAllRootLocksReleasedAcrossBothStorageCalls() throws Exception {
    writing =
        (o, k, b) -> {
          assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
          try (var c =
                  DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
              var q = c.createStatement()) {
            c.setAutoCommit(false);
            var a =
                q.executeQuery(
                    "SELECT state,version,storage_object_id FROM pattern_artifact WHERE style_id='"
                        + style.id()
                        + "'");
            assertThat(a.next()).isTrue();
            assertThat(a.getString(1)).isEqualTo("PENDING");
            assertThat(a.getLong(2)).isZero();
            assertThat(a.getObject(3, UUID.class)).isEqualTo(k);
            for (String sql :
                List.of(
                    "SELECT id FROM project WHERE id='" + project.id() + "' FOR UPDATE NOWAIT",
                    "SELECT id FROM style WHERE id='" + style.id() + "' FOR UPDATE NOWAIT",
                    "SELECT id FROM pattern WHERE id='" + family.id() + "' FOR UPDATE NOWAIT"))
              assertThat(q.executeQuery(sql).next()).isTrue();
            c.rollback();
          } catch (SQLException e) {
            throw new AssertionError(e);
          }
          assertThat(events("upload_started")).isEqualTo(1);
          assertThat(events("ready")).isZero();
          objects.put(o + "/" + k, b.clone());
        };
    reading =
        (o, k) -> {
          assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
          assertThat(state()).isEqualTo("PENDING");
          assertThat(events("ready")).isZero();
          return objects.get(o + "/" + k);
        };
    var result = upload();
    assertThat(result.artifact().state().name()).isEqualTo("READY");
    assertThat(events("ready")).isEqualTo(1);
    verify(port, times(1)).put(any(), any(), any());
    verify(port, times(1)).get(any(), any());
  }

  @ParameterizedTest
  @ValueSource(strings = {"upload_started", "ready", "failed"})
  void actualLateAuditRollback(String phase) throws Exception {
    doAnswer(
            a -> {
              a.callRealMethod();
              throw new IllegalStateException("synthetic late rollback");
            })
        .when(auditTarget())
        .organizationChanged(
            eq(org), eq("pattern_artifact." + phase), any(), any(), any(), any(), any());
    if (phase.equals("failed"))
      writing =
          (o, k, b) -> {
            objects.put(o + "/" + k, new byte[] {b[0]});
            throw new IOException("synthetic");
          };
    if (phase.equals("failed")) status(this::upload, 500);
    else assertThatThrownBy(this::upload).isInstanceOf(IllegalStateException.class);
    assertThat(events(phase)).isZero();
    assertThat(patternCount("pattern_revision")).isEqualTo(phase.equals("upload_started") ? 1 : 2);
    if (phase.equals("upload_started")) {
      verifyNoInteractions(port);
      assertThat(objects).isEmpty();
      assertThat(
              jdbc.sql("SELECT count(*) FROM pattern_artifact WHERE style_id=:style")
                  .param("style", style.id())
                  .query(Integer.class)
                  .single())
          .isZero();
    } else {
      assertThat(state()).isEqualTo("PENDING");
      assertThat(objects).hasSize(1);
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void ioWriteFailureRetainsNoneOrPrefix(boolean partial) throws Exception {
    writing =
        (o, k, b) -> {
          if (partial) objects.put(o + "/" + k, new byte[] {b[0]});
          throw new IOException("synthetic private IO path");
        };
    status(this::upload, 500);
    assertThat(state()).isEqualTo("FAILED");
    assertThat(objects).hasSize(partial ? 1 : 0);
    assertThat(events("failed")).isEqualTo(1);
    assertThat(
            jdbc.sql("SELECT failure_code FROM pattern_artifact WHERE style_id=:style")
                .param("style", style.id())
                .query(String.class)
                .single())
        .isEqualTo("STORAGE_WRITE_FAILED");
    clearInvocations(port);
    actor(owner);
    status(() -> artifacts.content(org, project.id(), style.id(), family.id(), revisionId()), 409);
    verifyNoInteractions(port);
  }

  @ParameterizedTest
  @ValueSource(strings = {"io", "length", "hash"})
  void readbackFailureIsBoundedAndRetained(String kind) throws Exception {
    reading =
        (o, k) -> {
          if (kind.equals("io")) throw new IOException("synthetic readback");
          var b = objects.get(o + "/" + k).clone();
          if (kind.equals("length")) return new byte[1];
          b[5] ^= 1;
          return b;
        };
    status(this::upload, 500);
    assertThat(state()).isEqualTo("FAILED");
    assertThat(objects).hasSize(1);
    assertThat(events("failed")).isEqualTo(1);
    assertThat(
            jdbc.sql("SELECT failure_code FROM pattern_artifact WHERE style_id=:style")
                .param("style", style.id())
                .query(String.class)
                .single())
        .isEqualTo(kind.equals("io") ? "STORAGE_READBACK_FAILED" : "STORAGE_INTEGRITY_MISMATCH");
  }

  @ParameterizedTest
  @ValueSource(strings = {"before-tx1", "before-put", "before-read", "before-ready"})
  void revocationIsNeverMislabeledStorageFailure(String phase) throws Exception {
    if (phase.equals("before-put"))
      doAnswer(
              a -> {
                a.callRealMethod();
                revoke();
                return null;
              })
          .when(auditTarget())
          .organizationChanged(
              eq(org), eq("pattern_artifact.upload_started"), any(), any(), any(), any(), any());
    if (phase.equals("before-read"))
      writing =
          (o, k, b) -> {
            objects.put(o + "/" + k, b.clone());
            revoke();
          };
    if (phase.equals("before-ready"))
      reading =
          (o, k) -> {
            var b = objects.get(o + "/" + k);
            revoke();
            return b;
          };
    if (phase.equals("before-tx1"))
      status(
          () ->
              artifacts.upload(
                  org,
                  project.id(),
                  style.id(),
                  family.id(),
                  artifactInput(),
                  () -> {
                    revoke();
                    return new ByteArrayInputStream(pdf());
                  },
                  "artifact-reference"),
          403);
    else status(this::upload, 403);
    assertThat(events("failed")).isZero();
    assertThat(events("ready")).isZero();
    assertThat(objects).hasSize(Set.of("before-read", "before-ready").contains(phase) ? 1 : 0);
    if (phase.equals("before-tx1")) assertThat(events("upload_started")).isZero();
    else assertThat(state()).isEqualTo("PENDING");
    if (Set.of("before-put", "before-tx1").contains(phase)) verifyNoInteractions(port);
    if (phase.equals("before-read")) verify(port, never()).get(any(), any());
  }

  @ParameterizedTest
  @CsvSource({
    "project,false",
    "style,false",
    "pattern,false",
    "project,true",
    "style,true",
    "pattern,true"
  })
  void archiveDuringStorageRetainsPending(String parent, boolean fails) throws Exception {
    writing =
        (o, k, b) -> {
          objects.put(o + "/" + k, fails ? new byte[] {b[0]} : b.clone());
          archive(parent);
          if (fails) throw new IOException("synthetic partial");
        };
    status(this::upload, fails ? 500 : 409);
    assertThat(state()).isEqualTo("PENDING");
    assertThat(objects).hasSize(1);
    assertThat(events("failed")).isZero();
    assertThat(events("ready")).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"project", "style", "pattern"})
  void archiveBeforePreflightDoesNotOpenFile(String parent) throws Exception {
    archive(parent);
    var opens = new AtomicInteger();
    status(
        () ->
            artifacts.upload(
                org,
                project.id(),
                style.id(),
                family.id(),
                artifactInput(),
                () -> {
                  opens.incrementAndGet();
                  return new ByteArrayInputStream(pdf());
                },
                "artifact-reference"),
        409);
    assertThat(opens).hasValue(0);
    assertThat(events("upload_started")).isZero();
    verifyNoInteractions(port);
  }

  @Test
  void viewerPreflightDoesNotReadHeapOrProbe() throws Exception {
    String v = "viewer-" + id();
    membership(org, v, "VIEWER", "ACTIVE");
    actor(v);
    var opens = new AtomicInteger();
    status(
        () ->
            artifacts.upload(
                org,
                project.id(),
                style.id(),
                family.id(),
                artifactInput(),
                () -> {
                  opens.incrementAndGet();
                  return new ByteArrayInputStream(new byte[10]);
                },
                "artifact-reference"),
        403);
    assertThat(opens).hasValue(0);
    verifyNoInteractions(port);
  }

  @Test
  void laterMetadataRevisionDoesNotBlockExactArtifactReady() throws Exception {
    writing =
        (o, k, b) -> {
          assertThat(state()).isEqualTo("PENDING");
          patterns.createRevision(
              org, project.id(), style.id(), family.id(), next(2), "later-metadata");
          objects.put(o + "/" + k, b.clone());
        };
    var r = upload();
    assertThat(r.revision().revisionNumber()).isEqualTo(2);
    assertThat(
            patterns
                .read(org, project.id(), style.id(), family.id())
                .latestRevision()
                .revisionNumber())
        .isEqualTo(3);
    assertThat(r.artifact().state().name()).isEqualTo("READY");
    assertThat(
            artifacts
                .content(org, project.id(), style.id(), family.id(), r.revision().id())
                .bytes())
        .isEqualTo(pdf());
  }

  @Test
  void responseLossAfterReadyDoesNotRepeatStorage() throws Exception {
    assertThatThrownBy(
            () -> {
              upload();
              throw new IOException("synthetic lost response");
            })
        .isInstanceOf(IOException.class);
    assertThat(state()).isEqualTo("READY");
    assertThat(objects).hasSize(1);
    assertThat(events("ready")).isEqualTo(1);
    verify(port, times(1)).put(any(), any(), any());
  }

  @Test
  void storageCrashRetainsReservationWithoutFalseFailure() throws Exception {
    writing =
        (o, k, b) -> {
          objects.put(o + "/" + k, b.clone());
          throw new AssertionError("synthetic crash");
        };
    assertThatThrownBy(this::upload).isInstanceOf(AssertionError.class);
    assertThat(state()).isEqualTo("PENDING");
    assertThat(events("failed")).isZero();
    assertThat(objects).hasSize(1);
  }
}
