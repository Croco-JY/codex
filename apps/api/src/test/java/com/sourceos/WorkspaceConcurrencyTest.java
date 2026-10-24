package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.project.ProjectService;
import com.sourceos.style.StyleService;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.server.ResponseStatusException;

/** Real independent PostgreSQL sessions; a timeout is always a failure, never a race outcome. */
class WorkspaceConcurrencyTest extends WorkspaceIntegrationSupport {
  enum Child {
    CREATE,
    UPDATE,
    REACTIVATE
  }

  record Outcome(int status, UUID id) {}

  void timeouts() {
    jdbc.sql("SET LOCAL lock_timeout='5s'").update();
    jdbc.sql("SET LOCAL statement_timeout='8s'").update();
  }

  Outcome inTransaction(Callable<Outcome> command) {
    actor(owner);
    try {
      return transaction()
          .execute(
              tx -> {
                timeouts();
                try {
                  return command.call();
                } catch (RuntimeException e) {
                  throw e;
                } catch (Exception e) {
                  throw new IllegalStateException(e);
                }
              });
    } catch (ResponseStatusException conflict) {
      return new Outcome(conflict.getStatusCode().value(), null);
    } finally {
      SecurityContextHolder.clearContext();
    }
  }

  void await(CountDownLatch latch) throws InterruptedException {
    assertThat(latch.await(5, TimeUnit.SECONDS)).as("bounded latch wait").isTrue();
  }

  void waitingForDatabaseLock(int pid) throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
    boolean waiting = false;
    while (System.nanoTime() < deadline) {
      waiting =
          jdbc.sql("SELECT cardinality(pg_blocking_pids(:pid))>0")
              .param("pid", pid)
              .query(Boolean.class)
              .single();
      if (waiting) break;
      Thread.sleep(10); // Poll actual pg lock state; not timing-based race synchronization.
    }
    assertThat(waiting).as("second independent PostgreSQL session actually blocked").isTrue();
  }

  List<Outcome> race(Callable<Outcome> firstCommand, Callable<Outcome> secondCommand)
      throws Exception {
    var locked = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var secondPid = new CompletableFuture<Integer>();
    var executor = Executors.newFixedThreadPool(2);
    Future<Outcome> first = null, second = null;
    try {
      first =
          executor.submit(
              () ->
                  inTransaction(
                      () -> {
                        projects.lockContextForWrite(org, project.id());
                        locked.countDown();
                        await(release);
                        return firstCommand.call();
                      }));
      await(locked);
      second =
          executor.submit(
              () ->
                  inTransaction(
                      () -> {
                        secondPid.complete(
                            jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                        return secondCommand.call();
                      }));
      waitingForDatabaseLock(secondPid.get(3, TimeUnit.SECONDS));
      release.countDown();
      return List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
    } finally {
      release.countDown();
      if (first != null) first.cancel(true);
      if (second != null) second.cancel(true);
      executor.shutdownNow();
      assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }

  Outcome archive() {
    var v =
        projects.update(
            org,
            project.id(),
            new ProjectService.UpdateInput(
                project.name(), project.description(), ProjectService.Status.ARCHIVED, 0L),
            "race-reference");
    return new Outcome(200, v.id());
  }

  Outcome child(Child operation) {
    if (operation == Child.CREATE) {
      var v =
          styles.create(
              org,
              project.id(),
              new StyleService.CreateInput(null, "Created in race", null),
              "race-reference");
      return new Outcome(201, v.id());
    }
    var v =
        styles.update(
            org,
            project.id(),
            style.id(),
            new StyleService.UpdateInput(
                style.styleCode(),
                operation == Child.UPDATE ? "Changed in race" : style.name(),
                style.description(),
                StyleService.Status.ACTIVE,
                operation == Child.REACTIVATE ? 1L : 0L),
            "race-reference");
    return new Outcome(200, v.id());
  }

  static Stream<Arguments> archiveRaces() {
    return Stream.of(Child.values())
        .flatMap(c -> Stream.of(Arguments.of(c, true), Arguments.of(c, false)));
  }

  @ParameterizedTest
  @MethodSource("archiveRaces")
  void projectArchiveSerializesWithCreateUpdateAndReactivation(
      Child operation, boolean archiveFirst) throws Exception {
    if (operation == Child.REACTIVATE)
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
          "fixture-archive");
    long before =
        jdbc.sql(
                "SELECT count(*) FROM audit_event WHERE entity_type='Style' AND"
                    + " organization_id=:org")
            .param("org", org)
            .query(Long.class)
            .single();
    var outcomes =
        archiveFirst
            ? race(this::archive, () -> child(operation))
            : race(() -> child(operation), this::archive);
    assertThat(outcomes.get(archiveFirst ? 0 : 1).status()).isEqualTo(200);
    assertThat(outcomes.get(archiveFirst ? 1 : 0).status())
        .isEqualTo(archiveFirst ? 409 : operation == Child.CREATE ? 201 : 200);
    actor(owner);
    var parent = projects.read(org, project.id());
    assertThat(parent.status()).isEqualTo(ProjectService.Status.ARCHIVED);
    assertThat(parent.version()).isEqualTo(1);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM audit_event WHERE entity_type='Style' AND"
                        + " organization_id=:org")
                .param("org", org)
                .query(Long.class)
                .single())
        .isEqualTo(before + (archiveFirst ? 0 : 1));
    if (operation == Child.CREATE) {
      assertThat(styles.list(org, project.id(), null, 25, 0).items()).hasSize(archiveFirst ? 1 : 2);
    } else {
      var current = styles.read(org, project.id(), style.id());
      assertThat(current.version())
          .isEqualTo((operation == Child.REACTIVATE ? 1 : 0) + (archiveFirst ? 0 : 1));
      assertThat(current.status())
          .isEqualTo(
              archiveFirst && operation == Child.REACTIVATE
                  ? StyleService.Status.ARCHIVED
                  : StyleService.Status.ACTIVE);
      assertThat(current.name())
          .isEqualTo(!archiveFirst && operation == Child.UPDATE ? "Changed in race" : style.name());
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void twoVersionZeroWritersHaveOneSuccessAndOne409WithoutLosingAudit(boolean child)
      throws Exception {
    UUID target = child ? style.id() : project.id();
    long before = auditCount(target);
    Callable<Outcome> write =
        () -> {
          if (child)
            styles.update(
                org,
                project.id(),
                style.id(),
                new StyleService.UpdateInput(
                    null, "Winning edit", null, StyleService.Status.ACTIVE, 0L),
                "race-reference");
          else
            projects.update(
                org,
                project.id(),
                new ProjectService.UpdateInput(
                    "Winning edit", null, ProjectService.Status.ACTIVE, 0L),
                "race-reference");
          return new Outcome(200, target);
        };
    assertThat(race(write, write)).extracting(Outcome::status).containsExactly(200, 409);
    actor(owner);
    assertThat(
            child
                ? styles.read(org, project.id(), style.id()).version()
                : projects.read(org, project.id()).version())
        .isEqualTo(1);
    assertThat(auditCount(target)).isEqualTo(before + 1);
    assertThat(
            child
                ? projects.read(org, project.id()).version()
                : styles.read(org, project.id(), style.id()).version())
        .isZero();
  }

  @Test
  void styleWaitsOnItsOwnRowOnlyAfterAcquiringProjectRootLock() throws Exception {
    var executor = Executors.newSingleThreadExecutor();
    var pid = new CompletableFuture<Integer>();
    Future<Outcome> future = null;
    try (var holder =
        DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword())) {
      holder.setAutoCommit(false);
      try {
        try (var q = holder.createStatement()) {
          q.execute("SET LOCAL lock_timeout='5s'");
          q.execute("SELECT id FROM style WHERE id='" + style.id() + "' FOR UPDATE");
        }
        future =
            executor.submit(
                () ->
                    inTransaction(
                        () -> {
                          pid.complete(
                              jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                          return child(Child.UPDATE);
                        }));
        waitingForDatabaseLock(pid.get(3, TimeUnit.SECONDS));
        try (var probe =
            DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword())) {
          probe.setAutoCommit(false);
          try (var q = probe.createStatement()) {
            q.execute("SET LOCAL lock_timeout='5s'");
            assertThatThrownBy(
                    () ->
                        q.execute(
                            "SELECT id FROM project WHERE id='"
                                + project.id()
                                + "' FOR UPDATE NOWAIT"))
                .isInstanceOfSatisfying(
                    SQLException.class, e -> assertThat(e.getSQLState()).isEqualTo("55P03"));
          } finally {
            probe.rollback();
          }
        }
        holder.commit();
        assertThat(future.get(10, TimeUnit.SECONDS).status()).isEqualTo(200);
      } finally {
        holder.rollback();
      }
    } finally {
      if (future != null) future.cancel(true);
      executor.shutdownNow();
      assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }
}
