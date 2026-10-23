package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.IOException;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.server.ResponseStatusException;

class StyleDevelopmentReferenceConcurrencyTest extends StyleDevelopmentReferenceSupport {
  int outcome(Callable<?> call) throws Exception {
    actor(owner);
    try {
      call.call();
      return 200;
    } catch (ResponseStatusException e) {
      return e.getStatusCode().value();
    } finally {
      SecurityContextHolder.clearContext();
    }
  }

  void waiting(int pid) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
    boolean waits = false;
    while (System.nanoTime() < deadline) {
      waits =
          jdbc.sql("SELECT cardinality(pg_blocking_pids(:pid))>0")
              .param("pid", pid)
              .query(Boolean.class)
              .single();
      if (waits) break;
      Thread.sleep(10);
    }
    assertThat(waits).as("independent PostgreSQL transaction waits on the lock chain").isTrue();
  }

  @Test
  void concurrentDetachHasOneWinnerAndOneAudit() throws Exception {
    var v = upload();
    var held = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var pid = new CompletableFuture<Integer>();
    var ex = Executors.newFixedThreadPool(2);
    try {
      var first =
          ex.submit(
              () ->
                  outcome(
                      () ->
                          transaction()
                              .execute(
                                  t -> {
                                    references.detach(
                                        org, project.id(), style.id(), v.id(), 1, "first");
                                    held.countDown();
                                    try {
                                      assertThat(release.await(8, TimeUnit.SECONDS)).isTrue();
                                    } catch (InterruptedException e) {
                                      throw new RuntimeException(e);
                                    }
                                    return 200;
                                  })));
      assertThat(held.await(8, TimeUnit.SECONDS)).isTrue();
      var second =
          ex.submit(
              () ->
                  outcome(
                      () ->
                          transaction()
                              .execute(
                                  t -> {
                                    jdbc.sql("SET LOCAL lock_timeout='6s'").update();
                                    pid.complete(
                                        jdbc.sql("SELECT pg_backend_pid()")
                                            .query(Integer.class)
                                            .single());
                                    return references.detach(
                                        org, project.id(), style.id(), v.id(), 1, "second");
                                  })));
      waiting(pid.get(4, TimeUnit.SECONDS));
      release.countDown();
      assertThat(first.get(10, TimeUnit.SECONDS)).isEqualTo(200);
      assertThat(second.get(10, TimeUnit.SECONDS)).isEqualTo(409);
      state("DETACHED", 2);
      assertThat(lifecycle("detached")).isEqualTo(1);
    } finally {
      release.countDown();
      ex.shutdownNow();
      assertThat(ex.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void independentDetachDuringStorageIsTerminalAndPartialBytesRetained(boolean storageFails)
      throws Exception {
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var ex = Executors.newSingleThreadExecutor();
    writing =
        (o, k, b) -> {
          entered.countDown();
          try {
            assertThat(release.await(8, TimeUnit.SECONDS)).isTrue();
          } catch (InterruptedException e) {
            throw new IOException(e);
          }
          objects.put(o + "/" + k, storageFails ? new byte[] {1} : b);
          if (storageFails) throw new IOException("synthetic partial");
        };
    try {
      var upload = ex.submit(() -> outcome(this::upload));
      assertThat(entered.await(8, TimeUnit.SECONDS)).isTrue();
      var v = only();
      references.detach(org, project.id(), style.id(), v.id(), 0, "detach-pending");
      release.countDown();
      assertThat(upload.get(10, TimeUnit.SECONDS)).isEqualTo(storageFails ? 500 : 409);
      state("DETACHED", 1);
      assertThat(objects).hasSize(1);
      assertThat(lifecycle("ready")).isZero();
      assertThat(lifecycle("failed")).isZero();
      assertThat(lifecycle("detached")).isEqualTo(1);
    } finally {
      release.countDown();
      ex.shutdownNow();
      assertThat(ex.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }

  @Test
  void readyWinsBeforeOldDetachRequiresExplicitCurrentVersion() {
    var v = upload();
    expectStatus(() -> references.detach(org, project.id(), style.id(), v.id(), 0, "stale"), 409);
    state("READY", 1);
    assertThat(lifecycle("detached")).isZero();
    references.detach(org, project.id(), style.id(), v.id(), 1, "explicit");
    state("DETACHED", 2);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void independentParentArchiveBetweenReservationAndFinalization(boolean parentStyle)
      throws Exception {
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var ex = Executors.newSingleThreadExecutor();
    writing =
        (o, k, b) -> {
          entered.countDown();
          try {
            assertThat(release.await(8, TimeUnit.SECONDS)).isTrue();
          } catch (InterruptedException e) {
            throw new IOException(e);
          }
          objects.put(o + "/" + k, b);
        };
    try {
      var upload = ex.submit(() -> outcome(this::upload));
      assertThat(entered.await(8, TimeUnit.SECONDS)).isTrue();
      archive(parentStyle);
      release.countDown();
      assertThat(upload.get(10, TimeUnit.SECONDS)).isEqualTo(409);
      state("PENDING", 0);
      assertThat(objects).hasSize(1);
      assertThat(lifecycle("ready")).isZero();
    } finally {
      release.countDown();
      ex.shutdownNow();
      assertThat(ex.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 1, 2})
  void detachLockChainIsProjectThenStyleThenReference(int hold) throws Exception {
    var v = upload();
    List<String> tables = List.of("project", "style", "style_development_reference");
    List<UUID> ids = List.of(project.id(), style.id(), v.id());
    var ex = Executors.newSingleThreadExecutor();
    var pid = new CompletableFuture<Integer>();
    try (var holder =
            DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
        var q = holder.createStatement()) {
      holder.setAutoCommit(false);
      q.execute(
          "SELECT id FROM " + tables.get(hold) + " WHERE id='" + ids.get(hold) + "' FOR UPDATE");
      var future =
          ex.submit(
              () ->
                  outcome(
                      () ->
                          transaction()
                              .execute(
                                  t -> {
                                    jdbc.sql("SET LOCAL lock_timeout='6s'").update();
                                    pid.complete(
                                        jdbc.sql("SELECT pg_backend_pid()")
                                            .query(Integer.class)
                                            .single());
                                    return references.detach(
                                        org, project.id(), style.id(), v.id(), 1, "lock-chain");
                                  })));
      waiting(pid.get(4, TimeUnit.SECONDS));
      try (var probe =
              DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
          var stmt = probe.createStatement()) {
        probe.setAutoCommit(false);
        for (int n = 0; n < 3; n++)
          if (n != hold) {
            var save = probe.setSavepoint();
            String sql =
                "SELECT id FROM "
                    + tables.get(n)
                    + " WHERE id='"
                    + ids.get(n)
                    + "' FOR UPDATE NOWAIT";
            if (n < hold)
              assertThatThrownBy(() -> stmt.execute(sql))
                  .isInstanceOfSatisfying(
                      SQLException.class, e -> assertThat(e.getSQLState()).isEqualTo("55P03"));
            else assertThat(stmt.executeQuery(sql).next()).isTrue();
            probe.rollback(save);
          }
        probe.rollback();
      }
      holder.commit();
      assertThat(future.get(10, TimeUnit.SECONDS)).isEqualTo(200);
    } finally {
      ex.shutdownNow();
      assertThat(ex.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }

  void waitsOnHolder(int holder) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
    boolean blocked = false;
    while (System.nanoTime() < deadline) {
      blocked =
          jdbc.sql(
                  "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE"
                      + " :holder=ANY(pg_blocking_pids(pid)))")
              .param("holder", holder)
              .query(Boolean.class)
              .single();
      if (blocked) break;
      Thread.sleep(10);
    }
    assertThat(blocked).as("independent parent/reservation transaction actually blocked").isTrue();
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void archiveTransactionWinsBeforeWaitingReservation(boolean parentStyle) throws Exception {
    var held = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var pid = new CompletableFuture<Integer>();
    var ex = Executors.newFixedThreadPool(2);
    try {
      var archive =
          ex.submit(
              () ->
                  outcome(
                      () ->
                          transaction()
                              .execute(
                                  t -> {
                                    archive(parentStyle);
                                    pid.complete(
                                        jdbc.sql("SELECT pg_backend_pid()")
                                            .query(Integer.class)
                                            .single());
                                    held.countDown();
                                    try {
                                      assertThat(release.await(8, TimeUnit.SECONDS)).isTrue();
                                    } catch (InterruptedException e) {
                                      throw new RuntimeException(e);
                                    }
                                    return 200;
                                  })));
      assertThat(held.await(8, TimeUnit.SECONDS)).isTrue();
      var upload = ex.submit(() -> outcome(this::upload));
      waitsOnHolder(pid.get(4, TimeUnit.SECONDS));
      release.countDown();
      assertThat(archive.get(10, TimeUnit.SECONDS)).isEqualTo(200);
      assertThat(upload.get(10, TimeUnit.SECONDS)).isEqualTo(409);
      assertThat(lifecycle("upload_started")).isZero();
      assertThat(objects).isEmpty();
    } finally {
      release.countDown();
      ex.shutdownNow();
      assertThat(ex.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void readyFinalizationWinsBeforeWaitingParentArchive(boolean parentStyle) throws Exception {
    var held = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var pid = new CompletableFuture<Integer>();
    var ex = Executors.newFixedThreadPool(2);
    doAnswer(
            a -> {
              a.callRealMethod();
              pid.complete(jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
              held.countDown();
              assertThat(release.await(8, TimeUnit.SECONDS)).isTrue();
              return null;
            })
        .when(auditTarget())
        .organizationChanged(
            eq(org), eq("development_reference.ready"), any(), any(), any(), any(), any());
    try {
      var upload = ex.submit(() -> outcome(this::upload));
      assertThat(held.await(8, TimeUnit.SECONDS)).isTrue();
      var archive =
          ex.submit(
              () ->
                  outcome(
                      () -> {
                        archive(parentStyle);
                        return 200;
                      }));
      waitsOnHolder(pid.get(4, TimeUnit.SECONDS));
      release.countDown();
      assertThat(upload.get(10, TimeUnit.SECONDS)).isEqualTo(200);
      assertThat(archive.get(10, TimeUnit.SECONDS)).isEqualTo(200);
      state("READY", 1);
      actor(owner);
      assertThat(
              references
                  .content(org, project.id(), style.id(), only().id(), "archived-ready")
                  .bytes())
          .containsExactly((byte) 1, (byte) 2, (byte) 3);
    } finally {
      release.countDown();
      ex.shutdownNow();
      assertThat(ex.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }
}
