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

class StyleMaterialSelectionConcurrencyTest extends StyleMaterialSelectionSupport {
  record Outcome(int status, UUID id) {}

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

  Outcome write() {
    return new Outcome(201, add(true, true).id());
  }

  UUID removing;

  Outcome remove() {
    selections.remove(org, project.id(), style.id(), removing, "remove-race");
    return new Outcome(204, removing);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void duplicateAndRemoveRaces(boolean adding) throws Exception {
    if (!adding) removing = add(true, true).id();
    long before =
        selectionAudits(adding ? "material_selection.added" : "material_selection.removed");
    var out = adding ? race(this::write, this::write) : race(this::remove, this::remove);
    assertThat(out)
        .extracting(Outcome::status)
        .containsExactly(adding ? 201 : 204, adding ? 409 : 404);
    actor(owner);
    assertThat(selections.list(org, project.id(), style.id(), 25, 0).items())
        .hasSize(adding ? 1 : 0);
    assertThat(selectionAudits(adding ? "material_selection.added" : "material_selection.removed"))
        .isEqualTo(before + 1);
  }

  static Stream<Arguments> catalogCases() {
    return Stream.of("material", "material_variant", "supplier_material_listing")
        .flatMap(table -> Stream.of(true, false).map(first -> Arguments.of(table, first)));
  }

  @ParameterizedTest
  @MethodSource("catalogCases")
  void archiveCatalogSerializesShareLock(String table, boolean archiveFirst) throws Exception {
    var id =
        table.equals("material") ? material : table.equals("material_variant") ? variant : listing;
    Callable<Outcome> archive =
        () -> {
          catalogStatus(table, id, "ARCHIVED");
          return new Outcome(200, id);
        };
    var out = archiveFirst ? race(archive, this::write) : race(this::write, archive);
    assertThat(out)
        .extracting(Outcome::status)
        .containsExactly(archiveFirst ? 200 : 201, archiveFirst ? 409 : 200);
    actor(owner);
    var rows = selections.list(org, project.id(), style.id(), 25, 0).items();
    assertThat(rows).hasSize(archiveFirst ? 0 : 1);
    assertThat(selectionAudits("material_selection.added")).isEqualTo(archiveFirst ? 0 : 1);
    if (!archiveFirst) {
      var v = rows.getFirst();
      assertThat(v.materialId()).isEqualTo(material);
      assertThat(v.variantId()).isEqualTo(variant);
      assertThat(v.listingId()).isEqualTo(listing);
      assertThat(v.id()).isEqualTo(out.getFirst().id());
    }
  }

  static Stream<Arguments> parents() {
    return Stream.of(true, false)
        .flatMap(
            p ->
                Stream.of(true, false)
                    .flatMap(
                        add -> Stream.of(true, false).map(first -> Arguments.of(p, add, first))));
  }

  Outcome archive(boolean p) {
    if (p)
      projects.update(
          org,
          project.id(),
          new ProjectService.UpdateInput(
              project.name(), project.description(), ProjectService.Status.ARCHIVED, 0L),
          "archive");
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
          "archive");
    return new Outcome(200, null);
  }

  @ParameterizedTest
  @MethodSource("parents")
  void parentArchiveAddRemoveBothOrders(boolean p, boolean adding, boolean archiveFirst)
      throws Exception {
    if (!adding) removing = add(true, true).id();
    Callable<Outcome> child = adding ? this::write : this::remove;
    var out = archiveFirst ? race(() -> archive(p), child) : race(child, () -> archive(p));
    assertThat(out)
        .extracting(Outcome::status)
        .containsExactly(archiveFirst ? 200 : adding ? 201 : 204, archiveFirst ? 409 : 200);
    actor(owner);
    assertThat(selections.list(org, project.id(), style.id(), 25, 0).items())
        .hasSize(adding ? (archiveFirst ? 0 : 1) : (archiveFirst ? 1 : 0));
    assertThat(selectionAudits(adding ? "material_selection.added" : "material_selection.removed"))
        .isEqualTo(archiveFirst ? 0 : 1);
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 1, 2, 3, 4})
  void fullLockChainProvenWithIndependentProbes(int hold) throws Exception {
    List<String> tables =
        List.of("project", "style", "material", "material_variant", "supplier_material_listing");
    List<UUID> ids = List.of(project.id(), style.id(), material, variant, listing);
    var ex = Executors.newSingleThreadExecutor();
    var pid = new CompletableFuture<Integer>();
    Future<Outcome> future = null;
    try (var holder =
        DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword())) {
      holder.setAutoCommit(false);
      try (var q = holder.createStatement()) {
        q.execute(
            "SELECT id FROM " + tables.get(hold) + " WHERE id='" + ids.get(hold) + "' FOR UPDATE");
        future =
            ex.submit(
                () ->
                    tx(
                        () -> {
                          pid.complete(
                              jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                          return write();
                        }));
        waiting(pid.get(3, TimeUnit.SECONDS));
        try (var probe =
                DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
            var stmt = probe.createStatement()) {
          probe.setAutoCommit(false);
          for (int n = 0; n < 5; n++)
            if (n != hold) {
              var point = probe.setSavepoint();
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
              probe.rollback(point);
            }
          probe.rollback();
        }
        holder.commit();
        assertThat(future.get(10, TimeUnit.SECONDS).status()).isEqualTo(201);
      } finally {
        holder.rollback();
      }
    } finally {
      if (future != null) future.cancel(true);
      ex.shutdownNow();
      assertThat(ex.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }
}
