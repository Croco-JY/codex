package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.project.ProjectService;
import com.sourceos.style.StyleService;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.server.ResponseStatusException;

class MeasurementConcurrencyTest extends MeasurementSupport {
  int tx(Callable<Integer> command) {
    actor(owner);
    try {
      return transaction()
          .execute(
              t -> {
                jdbc.sql("SET LOCAL lock_timeout='6s'").update();
                try {
                  return command.call();
                } catch (RuntimeException e) {
                  throw e;
                } catch (Exception e) {
                  throw new RuntimeException(e);
                }
              });
    } catch (ResponseStatusException e) {
      return e.getStatusCode().value();
    } finally {
      SecurityContextHolder.clearContext();
    }
  }

  void waiting(int pid) throws Exception {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
    boolean blocked = false;
    while (System.nanoTime() < end) {
      blocked =
          jdbc.sql("SELECT cardinality(pg_blocking_pids(:pid))>0")
              .param("pid", pid)
              .query(Boolean.class)
              .single();
      if (blocked) break;
      Thread.sleep(10);
    }
    assertThat(blocked).as("actual independent PostgreSQL waiter").isTrue();
  }

  List<Integer> race(Callable<Integer> first, Callable<Integer> second) throws Exception {
    var held = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var pid = new CompletableFuture<Integer>();
    var ex = Executors.newFixedThreadPool(2);
    try {
      var a =
          ex.submit(
              () ->
                  tx(
                      () -> {
                        int result = first.call();
                        held.countDown();
                        assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
                        return result;
                      }));
      assertThat(held.await(5, TimeUnit.SECONDS)).isTrue();
      var b =
          ex.submit(
              () ->
                  tx(
                      () -> {
                        pid.complete(
                            jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                        return second.call();
                      }));
      waiting(pid.get(3, TimeUnit.SECONDS));
      release.countDown();
      return List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
    } finally {
      release.countDown();
      ex.shutdownNow();
      assertThat(ex.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }

  int initial() {
    measurements.create(org, project.id(), style.id(), input(), List.of("*"), "measurement-race");
    return 201;
  }

  int next() {
    measurements.createRevision(org, project.id(), style.id(), revision(1), "measurement-race");
    return 201;
  }

  int archive(boolean p) {
    if (p)
      projects.update(
          org,
          project.id(),
          new ProjectService.UpdateInput(
              project.name(), project.description(), ProjectService.Status.ARCHIVED, 0L),
          "measurement-archive");
    else
      styles.update(
          org,
          project.id(),
          style.id(),
          new StyleService.UpdateInput(
              style.styleCode(),
              style.name(),
              style.description(),
              StyleService.Status.ARCHIVED,
              0L),
          "measurement-archive");
    return 200;
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void twoWritersCannotCreateAnEmptySpecOrSilentlyAdvanceTwoRevisions(boolean initial)
      throws Exception {
    if (!initial) create();
    long before = audits();
    var result = initial ? race(this::initial, this::initial) : race(this::next, this::next);
    assertThat(result).containsExactly(201, initial ? 412 : 409);
    assertThat(count("measurement_spec")).isEqualTo(1);
    assertThat(count("measurement_revision")).isEqualTo(initial ? 1 : 2);
    assertThat(count("measurement_point")).isEqualTo(initial ? 1 : 2);
    assertThat(audits()).isEqualTo(before + (initial ? 2 : 1));
  }

  @ParameterizedTest
  @CsvSource({"true,true", "true,false", "false,true", "false,false"})
  void parentArchiveAndRevisionSerializeInBothOrders(boolean p, boolean archiveFirst)
      throws Exception {
    create();
    long before = audits();
    var result =
        archiveFirst ? race(() -> archive(p), this::next) : race(this::next, () -> archive(p));
    assertThat(result)
        .containsExactlyElementsOf(archiveFirst ? List.of(200, 409) : List.of(201, 200));
    assertThat(audits()).isEqualTo(before + (archiveFirst ? 0 : 1));
    actor(owner);
    assertThat(measurements.read(org, project.id(), style.id()).latestRevision().revisionNumber())
        .isEqualTo(archiveFirst ? 1 : 2);
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 1, 2})
  void projectThenStyleThenSpecOrderWithIndependentNowaitProbes(int hold) throws Exception {
    var s = create();
    var ex = Executors.newSingleThreadExecutor();
    var pid = new CompletableFuture<Integer>();
    var tables = List.of("project", "style", "measurement_spec");
    var ids = List.of(project.id(), style.id(), s.id());
    try (var c = DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      q.executeQuery(
          "SELECT id FROM " + tables.get(hold) + " WHERE id='" + ids.get(hold) + "' FOR UPDATE");
      var f =
          ex.submit(
              () ->
                  tx(
                      () -> {
                        pid.complete(
                            jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                        return next();
                      }));
      waiting(pid.get(3, TimeUnit.SECONDS));
      try (var probe =
              DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
          var p = probe.createStatement()) {
        probe.setAutoCommit(false);
        for (int n = 0; n < 3; n++) {
          if (n == hold) continue;
          var save = probe.setSavepoint();
          String sql =
              "SELECT id FROM "
                  + tables.get(n)
                  + " WHERE id='"
                  + ids.get(n)
                  + "' FOR UPDATE NOWAIT";
          if (n < hold)
            assertThatThrownBy(() -> p.execute(sql))
                .isInstanceOf(SQLException.class)
                .satisfies(e -> assertThat(((SQLException) e).getSQLState()).isEqualTo("55P03"));
          else assertThat(p.executeQuery(sql).next()).isTrue();
          probe.rollback(save);
        }
        probe.rollback();
      }
      c.commit();
      assertThat(f.get(10, TimeUnit.SECONDS)).isEqualTo(201);
    } finally {
      ex.shutdownNow();
      assertThat(ex.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }
}
