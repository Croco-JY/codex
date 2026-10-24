package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.project.ProjectService;
import com.sourceos.style.StyleService;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.server.ResponseStatusException;

class StyleRequirementConcurrencyTest extends StyleRequirementSupport {
  record Outcome(int status, String product) {}

  void timeouts() {
    jdbc.sql("SET LOCAL lock_timeout='5s'").update();
    jdbc.sql("SET LOCAL statement_timeout='8s'").update();
  }

  Outcome tx(Callable<Outcome> command) {
    actor(owner);
    try {
      return transaction()
          .execute(
              t -> {
                timeouts();
                try {
                  return command.call();
                } catch (RuntimeException e) {
                  throw e;
                } catch (Exception e) {
                  throw new IllegalStateException(e);
                }
              });
    } catch (ResponseStatusException e) {
      return new Outcome(e.getStatusCode().value(), null);
    } finally {
      SecurityContextHolder.clearContext();
    }
  }

  void waiting(int pid) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
    boolean blocked = false;
    while (System.nanoTime() < deadline) {
      blocked =
          jdbc.sql("SELECT cardinality(pg_blocking_pids(:pid))>0")
              .param("pid", pid)
              .query(Boolean.class)
              .single();
      if (blocked) break;
      Thread.sleep(10);
    }
    assertThat(blocked).as("independent PostgreSQL writer actually waits on a row lock").isTrue();
  }

  List<Outcome> race(Callable<Outcome> a, Callable<Outcome> b) throws Exception {
    var held = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var pid = new CompletableFuture<Integer>();
    var executor = Executors.newFixedThreadPool(2);
    Future<Outcome> first = null, second = null;
    try {
      first =
          executor.submit(
              () ->
                  tx(
                      () -> {
                        var result = a.call();
                        held.countDown();
                        assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
                        return result;
                      }));
      assertThat(held.await(5, TimeUnit.SECONDS)).isTrue();
      second =
          executor.submit(
              () ->
                  tx(
                      () -> {
                        pid.complete(
                            jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                        return b.call();
                      }));
      waiting(pid.get(3, TimeUnit.SECONDS));
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

  Outcome write(boolean create, String product) {
    var r =
        requirements.write(
            org,
            project.id(),
            style.id(),
            input(0, product),
            create ? "*" : null,
            "requirement-race");
    return new Outcome(r.created() ? 201 : 200, r.view().productType());
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void competingWritersHaveExactlyOneSuccessAndNoLosingAudit(boolean create) throws Exception {
    if (!create) create();
    long before = requirementAudits();
    var results =
        race(
            () -> write(create, "Winner exact values"),
            () -> write(create, "Loser different values"));
    assertThat(results)
        .extracting(Outcome::status)
        .containsExactly(create ? 201 : 200, create ? 412 : 409);
    actor(owner);
    var stored = requirements.read(org, project.id(), style.id());
    assertThat(stored.productType()).isEqualTo(results.getFirst().product());
    assertThat(stored.version()).isEqualTo(create ? 0 : 1);
    assertThat(requirementAudits()).isEqualTo(before + 1);
    assertThat(
            jdbc.sql("SELECT count(*) FROM style_requirement WHERE style_id=:id")
                .param("id", style.id())
                .query(Long.class)
                .single())
        .isEqualTo(1);
    assertThat(projects.read(org, project.id()).version()).isZero();
    assertThat(styles.read(org, project.id(), style.id()).version()).isZero();
  }

  static Stream<Arguments> parents() {
    return Stream.of(true, false)
        .flatMap(
            project ->
                Stream.of(true, false)
                    .flatMap(
                        create ->
                            Stream.of(true, false)
                                .map(archiveFirst -> Arguments.of(project, create, archiveFirst))));
  }

  Outcome archive(boolean parentProject) {
    if (parentProject)
      projects.update(
          org,
          project.id(),
          new ProjectService.UpdateInput(
              project.name(), project.description(), ProjectService.Status.ARCHIVED, 0L),
          "archive-race");
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
          "archive-race");
    return new Outcome(200, null);
  }

  @ParameterizedTest
  @MethodSource("parents")
  void archiveAndRequirementWritesSerializeInBothOrders(
      boolean parentProject, boolean create, boolean archiveFirst) throws Exception {
    if (!create) create();
    long before = requirementAudits();
    var out =
        archiveFirst
            ? race(() -> archive(parentProject), () -> write(create, "Child change"))
            : race(() -> write(create, "Child change"), () -> archive(parentProject));
    assertThat(out.get(archiveFirst ? 0 : 1).status()).isEqualTo(200);
    assertThat(out.get(archiveFirst ? 1 : 0).status())
        .isEqualTo(archiveFirst ? 409 : create ? 201 : 200);
    actor(owner);
    assertThat(
            parentProject
                ? projects.read(org, project.id()).status().name()
                : styles.read(org, project.id(), style.id()).status().name())
        .isEqualTo("ARCHIVED");
    assertThat(requirementAudits()).isEqualTo(before + (archiveFirst ? 0 : 1));
    long rows =
        jdbc.sql("SELECT count(*) FROM style_requirement WHERE style_id=:id")
            .param("id", style.id())
            .query(Long.class)
            .single();
    assertThat(rows).isEqualTo(create && archiveFirst ? 0 : 1);
    if (rows > 0) {
      var v = requirements.read(org, project.id(), style.id());
      assertThat(v.version()).isEqualTo(create ? 0 : archiveFirst ? 0 : 1);
      assertThat(v.productType()).isEqualTo(archiveFirst ? "Original" : "Child change");
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void lockChainProjectThenStyleThenRequirement(boolean holdRequirement) throws Exception {
    create();
    var executor = Executors.newSingleThreadExecutor();
    var pid = new CompletableFuture<Integer>();
    Future<Outcome> future = null;
    try (var holder =
        DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword())) {
      holder.setAutoCommit(false);
      try {
        try (var q = holder.createStatement()) {
          q.execute("SET LOCAL lock_timeout='5s'");
          q.execute(
              holdRequirement
                  ? "SELECT style_id FROM style_requirement WHERE style_id='"
                      + style.id()
                      + "' FOR UPDATE"
                  : "SELECT id FROM style WHERE id='" + style.id() + "' FOR UPDATE");
        }
        future =
            executor.submit(
                () ->
                    tx(
                        () -> {
                          pid.complete(
                              jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                          return write(false, "Ordered locks");
                        }));
        waiting(pid.get(3, TimeUnit.SECONDS));
        try (var probe =
                DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
            var q = probe.createStatement()) {
          probe.setAutoCommit(false);
          try {
            for (String sql :
                holdRequirement
                    ? List.of(
                        "SELECT id FROM project WHERE id='" + project.id() + "' FOR UPDATE NOWAIT",
                        "SELECT id FROM style WHERE id='" + style.id() + "' FOR UPDATE NOWAIT")
                    : List.of(
                        "SELECT id FROM project WHERE id='"
                            + project.id()
                            + "' FOR UPDATE NOWAIT")) {
              var point = probe.setSavepoint();
              assertThatThrownBy(() -> q.execute(sql))
                  .isInstanceOfSatisfying(
                      SQLException.class, e -> assertThat(e.getSQLState()).isEqualTo("55P03"));
              probe.rollback(point);
            }
            if (!holdRequirement)
              assertThat(
                      q.executeQuery(
                              "SELECT style_id FROM style_requirement WHERE style_id='"
                                  + style.id()
                                  + "' FOR UPDATE NOWAIT")
                          .next())
                  .isTrue();
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
