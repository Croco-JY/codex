package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.patternqa.PatternQaModels.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.server.ResponseStatusException;

class PatternQaConcurrencyTest extends PatternQaSupport {
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

  void blocked(int pid) {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
    boolean waiting = false;
    while (System.nanoTime() < end) {
      waiting =
          jdbc.sql("SELECT cardinality(pg_blocking_pids(:pid))>0")
              .param("pid", pid)
              .query(Boolean.class)
              .single();
      if (waiting) break;
      Thread.onSpinWait();
    }
    assertThat(waiting)
        .as("independent PostgreSQL session blocked on accepted lock chain")
        .isTrue();
  }

  List<Integer> race(Callable<Integer> first, Callable<Integer> second) throws Exception {
    var held = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var pid = new CompletableFuture<Integer>();
    var pool = Executors.newFixedThreadPool(2);
    try {
      var a =
          pool.submit(
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
          pool.submit(
              () ->
                  tx(
                      () -> {
                        pid.complete(
                            jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                        return second.call();
                      }));
      blocked(pid.get(3, TimeUnit.SECONDS));
      release.countDown();
      return List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
    } finally {
      release.countDown();
      pool.shutdownNow();
      assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }

  int assessOne() {
    qa.create(
        org,
        project.id(),
        style.id(),
        family.id(),
        family.latestRevision().id(),
        assessment(0),
        "qa-race");
    return 201;
  }

  @Test
  void staleHeadWinnerOnlyAuditAndNoSilentNPlusTwo() throws Exception {
    assertThat(race(this::assessOne, this::assessOne)).containsExactly(201, 409);
    assertThat(qaAudits()).isEqualTo(1);
    actor(owner);
    assertThat(
            qa.read(org, project.id(), style.id(), family.id(), family.latestRevision().id())
                .latestAssessment()
                .assessmentNumber())
        .isEqualTo(1);
  }

  int archiveCommand(String parent) {
    if (parent.equals("pattern"))
      patterns.lifecycle(
          org,
          project.id(),
          style.id(),
          family.id(),
          new com.sourceos.pattern.PatternService.LifecycleInput(
              com.sourceos.pattern.PatternService.Status.ARCHIVED, 0L),
          "qa-archive");
    else if (parent.equals("project"))
      projects.update(
          org,
          project.id(),
          new com.sourceos.project.ProjectService.UpdateInput(
              project.name(),
              project.description(),
              com.sourceos.project.ProjectService.Status.ARCHIVED,
              project.version()),
          "qa-archive");
    else
      styles.update(
          org,
          project.id(),
          style.id(),
          new com.sourceos.style.StyleService.UpdateInput(
              style.styleCode(),
              style.name(),
              style.description(),
              com.sourceos.style.StyleService.Status.ARCHIVED,
              style.version()),
          "qa-archive");
    return 200;
  }

  @ParameterizedTest
  @CsvSource({
    "project,true",
    "project,false",
    "style,true",
    "style,false",
    "pattern,true",
    "pattern,false"
  })
  void parentArchiveBothOrders(String parent, boolean archiveFirst) throws Exception {
    Callable<Integer> archive = () -> archiveCommand(parent), assessment = this::assessOne;
    assertThat(race(archiveFirst ? archive : assessment, archiveFirst ? assessment : archive))
        .containsExactlyElementsOf(archiveFirst ? List.of(200, 409) : List.of(201, 200));
    assertThat(qaAudits()).isEqualTo(archiveFirst ? 0 : 1);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void newPatternRevisionCannotRetargetAnExactAssessment(boolean qaFirst) throws Exception {
    Callable<Integer> revision =
        () -> {
          patterns.createRevision(
              org, project.id(), style.id(), family.id(), next(1), "qa-revision-race");
          return 201;
        };
    assertThat(race(qaFirst ? this::assessOne : revision, qaFirst ? revision : this::assessOne))
        .containsExactly(201, 201);
    actor(owner);
    var newest = patterns.read(org, project.id(), style.id(), family.id()).latestRevision();
    assertThat(qa.read(org, project.id(), style.id(), family.id(), newest.id()).state())
        .isEqualTo(State.UNREVIEWED);
    assertThat(
            qa.read(org, project.id(), style.id(), family.id(), family.latestRevision().id())
                .state())
        .isEqualTo(State.OBSERVED);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void readinessIsCheckedAtSerializedBoundaryWithoutImplicitRetry(boolean finalizeFirst)
      throws Exception {
    if (!finalizeFirst) {
      var stored = new CountDownLatch(1);
      var release = new CountDownLatch(1);
      var pool = Executors.newSingleThreadExecutor();
      writing =
          (o, k, b) -> {
            objects.put(o + "/" + k, b.clone());
            stored.countDown();
            try {
              assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
            } catch (InterruptedException e) {
              throw new java.io.IOException(e);
            }
          };
      try {
        var upload =
            pool.submit(
                () -> {
                  actor(owner);
                  try {
                    return upload();
                  } finally {
                    SecurityContextHolder.clearContext();
                  }
                });
        assertThat(stored.await(5, TimeUnit.SECONDS)).isTrue();
        actor(owner);
        var revision = revisionId();
        var artifact =
            jdbc.sql("SELECT id FROM pattern_artifact WHERE pattern_revision_id=:revision")
                .param("revision", revision)
                .query(UUID.class)
                .single();
        assertThat(state()).isEqualTo("PENDING");
        assertThatThrownBy(
                () ->
                    qa.create(
                        org,
                        project.id(),
                        style.id(),
                        family.id(),
                        revision,
                        new Input(
                            0L,
                            Outcome.HUMAN_REVIEWED,
                            Basis.READY_ARTIFACT,
                            artifact,
                            "Not ready yet"),
                        "qa-before-ready"))
            .isInstanceOfSatisfying(
                ResponseStatusException.class,
                e -> assertThat(e.getStatusCode().value()).isEqualTo(409));
        release.countDown();
        assertThat(upload.get(8, TimeUnit.SECONDS).artifact().state())
            .isEqualTo(com.sourceos.pattern.PatternArtifactService.State.READY);
        assertThat(qaAudits()).isZero();
        assertThat(qa.read(org, project.id(), style.id(), family.id(), revision).state())
            .isEqualTo(State.UNREVIEWED);
      } finally {
        release.countDown();
        pool.shutdownNow();
        assertThat(pool.awaitTermination(8, TimeUnit.SECONDS)).isTrue();
      }
      return;
    }
    UUID revision = id(), artifact = id();
    transaction()
        .executeWithoutResult(
            t -> {
              jdbc.sql(
                      "INSERT INTO"
                          + " pattern_revision(id,pattern_id,style_id,revision_number,name,created_by_issuer,created_by_subject,artifact_expected)"
                          + " VALUES(:id,:pattern,:style,2,'Pending QA"
                          + " artifact','urn:synthetic','reviewer',true)")
                  .param("id", revision)
                  .param("pattern", family.id())
                  .param("style", style.id())
                  .update();
              jdbc.sql(
                      "INSERT INTO"
                          + " pattern_artifact(id,pattern_revision_id,style_id,storage_object_id,declared_format,display_name,size_bytes,sha256,state)"
                          + " VALUES(:id,:revision,:style,:object,'PDF','pending.pdf',1,:hash,'PENDING')")
                  .param("id", artifact)
                  .param("revision", revision)
                  .param("style", style.id())
                  .param("object", id())
                  .param("hash", "a".repeat(64))
                  .update();
            });
    Callable<Integer> assess =
        () -> {
          qa.create(
              org,
              project.id(),
              style.id(),
              family.id(),
              revision,
              new Input(
                  0L,
                  Outcome.HUMAN_REVIEWED,
                  Basis.READY_ARTIFACT,
                  artifact,
                  "Exact artifact reviewed"),
              "qa-ready-race");
          return 201;
        };
    Callable<Integer> finalize =
        () -> {
          // Same production hierarchy lock boundary as artifact finalization; update only
          // operational state.
          styles.lockContextForWrite(org, project.id(), style.id());
          jdbc.sql("SELECT id FROM pattern WHERE id=:id FOR UPDATE")
              .param("id", family.id())
              .query(UUID.class)
              .single();
          jdbc.sql(
                  "UPDATE pattern_artifact SET"
                      + " state='READY',version=1,updated_at=GREATEST(clock_timestamp(),updated_at+interval"
                      + " '1 microsecond') WHERE id=:id")
              .param("id", artifact)
              .update();
          return 200;
        };
    assertThat(race(finalize, assess)).containsExactly(200, 201);
    assertThat(qaAudits()).isEqualTo(1);
  }
}
