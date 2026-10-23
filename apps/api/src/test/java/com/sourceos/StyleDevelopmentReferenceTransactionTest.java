package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.IOException;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class StyleDevelopmentReferenceTransactionTest extends StyleDevelopmentReferenceSupport {
  @Test
  void reservationCommittedAndParentLocksReleasedBeforeStorage() {
    writing =
        (o, k, b) -> {
          assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
          try (var c =
                  DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
              var q = c.createStatement()) {
            c.setAutoCommit(false);
            var r =
                q.executeQuery(
                    "SELECT state,version,storage_object_id FROM style_development_reference WHERE"
                        + " style_id='"
                        + style.id()
                        + "'");
            assertThat(r.next()).isTrue();
            assertThat(r.getString(1)).isEqualTo("PENDING");
            assertThat(r.getLong(2)).isZero();
            assertThat(r.getObject(3, UUID.class)).isEqualTo(k);
            assertThat(
                    q.executeQuery(
                            "SELECT id FROM project WHERE id='"
                                + project.id()
                                + "' FOR UPDATE NOWAIT")
                        .next())
                .isTrue();
            assertThat(
                    q.executeQuery(
                            "SELECT id FROM style WHERE id='" + style.id() + "' FOR UPDATE NOWAIT")
                        .next())
                .isTrue();
            c.rollback();
          } catch (SQLException e) {
            throw new AssertionError(e);
          }
          assertThat(lifecycle("upload_started")).isEqualTo(1);
          assertThat(lifecycle("ready")).isZero();
          objects.put(o + "/" + k, b.clone());
        };
    upload();
    state("READY", 1);
  }

  @Test
  void reservationAuditRollbackNeverCallsStorage() {
    doThrow(new IllegalStateException("synthetic rollback"))
        .when(auditTarget())
        .organizationChanged(
            eq(org), eq("development_reference.upload_started"), any(), any(), any(), any(), any());
    assertThatThrownBy(this::upload).isInstanceOf(IllegalStateException.class);
    assertThat(references.list(org, project.id(), style.id(), null, 25, 0).items()).isEmpty();
    verifyNoInteractions(port);
    assertThat(lifecycle("upload_started")).isZero();
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void storageIOExceptionRetainsNoneOrPartialAndMarksFailed(boolean partial) throws Exception {
    writing =
        (o, k, b) -> {
          if (partial) objects.put(o + "/" + k, new byte[] {b[0]});
          throw new IOException("synthetic private error");
        };
    expectStatus(this::upload, 500);
    state("FAILED", 1);
    assertThat(objects).hasSize(partial ? 1 : 0);
    if (partial) assertThat(objects.values().iterator().next()).hasSize(1);
    assertThat(lifecycle("upload_started")).isEqualTo(1);
    assertThat(lifecycle("failed")).isEqualTo(1);
    assertThat(lifecycle("ready")).isZero();
    clearInvocations(port);
    problem(request("GET", path() + "/" + only().id() + "/content", owner, null), 409);
    verifyNoInteractions(port);
    actor(owner);
    references.detach(org, project.id(), style.id(), only().id(), 1, "detach-failed");
    state("DETACHED", 2);
  }

  @Test
  void failedAuditRollbackRetainsPartialBytesAndPendingReservation() {
    writing =
        (o, k, b) -> {
          objects.put(o + "/" + k, new byte[] {1});
          throw new IOException("synthetic partial failure");
        };
    doThrow(new IllegalStateException("synthetic failed audit rollback"))
        .when(auditTarget())
        .organizationChanged(
            eq(org), eq("development_reference.failed"), any(), any(), any(), any(), any());
    expectStatus(this::upload, 500);
    state("PENDING", 0);
    assertThat(objects.values().iterator().next()).hasSize(1);
    assertThat(lifecycle("failed")).isZero();
    assertThat(lifecycle("upload_started")).isEqualTo(1);
  }

  @Test
  void crashAfterReservationBeforeStorageLeavesPending() {
    writing =
        (o, k, b) -> {
          throw new AssertionError("synthetic crash");
        };
    assertThatThrownBy(this::upload).isInstanceOf(AssertionError.class);
    state("PENDING", 0);
    assertThat(objects).isEmpty();
    assertThat(lifecycle("upload_started")).isEqualTo(1);
    assertThat(lifecycle("failed")).isZero();
  }

  @Test
  void crashAfterStorageRetainsTrackedFullBytesWithoutReady() {
    writing =
        (o, k, b) -> {
          objects.put(o + "/" + k, b);
          throw new AssertionError("synthetic interruption after write");
        };
    assertThatThrownBy(this::upload).isInstanceOf(AssertionError.class);
    state("PENDING", 0);
    assertThat(objects.values().iterator().next()).containsExactly((byte) 1, (byte) 2, (byte) 3);
    assertThat(lifecycle("upload_started")).isEqualTo(1);
    assertThat(lifecycle("ready")).isZero();
  }

  @Test
  void storedBytesThenReadyRollbackRetainsPending() {
    doThrow(new IllegalStateException("synthetic ready rollback"))
        .when(auditTarget())
        .organizationChanged(
            eq(org), eq("development_reference.ready"), any(), any(), any(), any(), any());
    assertThatThrownBy(this::upload).isInstanceOf(IllegalStateException.class);
    state("PENDING", 0);
    assertThat(objects).hasSize(1);
    assertThat(lifecycle("ready")).isZero();
  }

  @Test
  void committedReadyRemainsAuthoritativeAfterCallerLosesResponse() throws Exception {
    assertThatThrownBy(
            () -> {
              upload();
              throw new IOException("synthetic response loss");
            })
        .isInstanceOf(IOException.class);
    state("READY", 1);
    assertThat(objects).hasSize(1);
    assertThat(lifecycle("ready")).isEqualTo(1);
    verify(port, times(1)).put(any(), any(), any());
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void parentArchiveBeforeReservationCreatesNothing(boolean parentStyle) {
    archive(parentStyle);
    clearInvocations(port);
    expectStatus(this::upload, 409);
    assertThat(lifecycle("upload_started")).isZero();
    verifyNoInteractions(port);
  }

  @ParameterizedTest
  @CsvSource({"true,false", "false,false", "true,true", "false,true"})
  void archiveAfterReservationBlocksFinalizationOrFailureMark(
      boolean parentStyle, boolean storageFails) {
    writing =
        (o, k, b) -> {
          objects.put(o + "/" + k, storageFails ? new byte[] {1} : b);
          archive(parentStyle);
          if (storageFails) throw new IOException("synthetic partial failure");
        };
    expectStatus(this::upload, storageFails ? 500 : 409);
    state("PENDING", 0);
    assertThat(objects).hasSize(1);
    assertThat(lifecycle("ready")).isZero();
    assertThat(lifecycle("failed")).isZero();
  }

  @Test
  void revocationBeforeReservationHasNoSideEffects() {
    revoke();
    expectStatus(this::upload, 403);
    assertThat(lifecycle("upload_started")).isZero();
    verifyNoInteractions(port);
  }

  @Test
  void revocationBetweenReservationAndPutNewPreventsBytes() {
    doAnswer(
            a -> {
              a.callRealMethod();
              if (a.getArgument(1).equals("development_reference.upload_started")) revoke();
              return null;
            })
        .when(auditTarget())
        .organizationChanged(eq(org), any(), any(), any(), any(), any(), any());
    expectStatus(this::upload, 403);
    verifyNoInteractions(port);
    assertThat(
            jdbc.sql("SELECT state FROM style_development_reference WHERE style_id=:id")
                .param("id", style.id())
                .query(String.class)
                .single())
        .isEqualTo("PENDING");
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void revocationAfterStoragePreventsReadyAndUnauthorizedFailureMark(boolean storageFails) {
    writing =
        (o, k, b) -> {
          objects.put(o + "/" + k, b);
          revoke();
          if (storageFails) throw new IOException("synthetic failure");
        };
    expectStatus(this::upload, storageFails ? 500 : 403);
    assertThat(objects).hasSize(1);
    assertThat(
            jdbc.sql("SELECT state FROM style_development_reference WHERE style_id=:id")
                .param("id", style.id())
                .query(String.class)
                .single())
        .isEqualTo("PENDING");
    assertThat(lifecycle("ready")).isZero();
    assertThat(lifecycle("failed")).isZero();
  }
}
