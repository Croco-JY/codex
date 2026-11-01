package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.patternrelease.*;
import com.sourceos.patternrelease.ReleaseModels.*;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.server.ResponseStatusException;

class PatternReleaseConcurrencyTest extends PatternArtifactSupport {
  @Autowired PatternReleaseService releases;
  @Autowired ReleaseConsentService consents;
  @Autowired com.sourceos.organization.OrganizationService organizations;
  @Autowired com.sourceos.patternqa.PatternQaService qa;
  UUID revision;
  ConsentView consent;

  void prepare() {
    revision = upload().revision().id();
    actor(foreignOwner);
    consent = consents.issue(foreignOrg, new ConsentCreateInput(org), "race-consent");
    actor(owner);
  }

  int consume() {
    actor(owner);
    releases.create(
        org,
        project.id(),
        style.id(),
        family.id(),
        revision,
        new CreateInput(consent.id(), 1L, "Race exact artifact", 86400),
        "race-release");
    return 201;
  }

  int withdraw() {
    actor(foreignOwner);
    consents.withdraw(foreignOrg, consent.id(), new EventCommand(1L), "race-withdraw");
    return 200;
  }

  int tx(Callable<Integer> f) {
    actor(owner);
    try {
      return transaction()
          .execute(
              s -> {
                jdbc.sql("SET LOCAL lock_timeout='6s'").update();
                try {
                  return f.call();
                } catch (RuntimeException e) {
                  throw e;
                } catch (Exception e) {
                  throw new RuntimeException(e);
                }
              });
    } catch (ResponseStatusException e) {
      return e.getStatusCode().value();
    } catch (AccessDeniedException e) {
      return 403;
    } finally {
      SecurityContextHolder.clearContext();
    }
  }

  void blocked(int pid) {
    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
    boolean seen = false;
    while (System.nanoTime() < until) {
      seen =
          jdbc.sql("SELECT cardinality(pg_blocking_pids(:pid))>0")
              .param("pid", pid)
              .query(Boolean.class)
              .single();
      if (seen) break;
      Thread.onSpinWait();
    }
    assertThat(seen).as("actual independent PostgreSQL lock wait").isTrue();
  }

  List<Integer> race(Callable<Integer> first, Callable<Integer> second) throws Exception {
    var held = new CountDownLatch(1);
    var commit = new CountDownLatch(1);
    var pid = new CompletableFuture<Integer>();
    try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
      var a =
          workers.submit(
              () ->
                  tx(
                      () -> {
                        int result = first.call();
                        held.countDown();
                        if (!commit.await(8, TimeUnit.SECONDS))
                          throw new IllegalStateException("barrier timeout");
                        return result;
                      }));
      assertThat(held.await(8, TimeUnit.SECONDS)).isTrue();
      var b =
          workers.submit(
              () ->
                  tx(
                      () -> {
                        pid.complete(
                            jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                        return second.call();
                      }));
      try {
        blocked(pid.get(4, TimeUnit.SECONDS));
      } finally {
        commit.countDown();
      }
      return List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
    } finally {
      commit.countDown();
    }
  }

  @Test
  void oneConsumerOneConflictOneAuditNoRetry() throws Exception {
    prepare();
    assertThat(race(this::consume, this::consume)).containsExactly(201, 409);
    assertThat(
            jdbc.sql("SELECT count(*) FROM pattern_release WHERE consent_id=:id")
                .param("id", consent.id())
                .query(Long.class)
                .single())
        .isEqualTo(1);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM pattern_release_consent_event WHERE consent_id=:id AND"
                        + " kind='CONSUMED'")
                .param("id", consent.id())
                .query(Long.class)
                .single())
        .isEqualTo(1);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM audit_event WHERE organization_id=:org AND"
                        + " action='pattern_release.created'")
                .param("org", org)
                .query(Long.class)
                .single())
        .isEqualTo(1);
  }

  @ParameterizedTest
  @CsvSource({"true", "false"})
  void consumptionVersusWithdrawalBothWinnerOrders(boolean consumeFirst) throws Exception {
    prepare();
    assertThat(
            consumeFirst
                ? race(this::consume, this::withdraw)
                : race(this::withdraw, this::consume))
        .containsExactly(consumeFirst ? 201 : 200, 409);
    actor(foreignOwner);
    assertThat(consents.read(foreignOrg, consent.id()).state())
        .isEqualTo(consumeFirst ? ConsentState.CONSUMED : ConsentState.WITHDRAWN);
  }

  int archiveParent(String parent) {
    actor(owner);
    switch (parent) {
      case "project" ->
          projects.update(
              org,
              project.id(),
              new com.sourceos.project.ProjectService.UpdateInput(
                  project.name(),
                  project.description(),
                  com.sourceos.project.ProjectService.Status.ARCHIVED,
                  0L),
              "release-project-archive");
      case "style" ->
          styles.update(
              org,
              project.id(),
              style.id(),
              new com.sourceos.style.StyleService.UpdateInput(
                  style.styleCode(),
                  style.name(),
                  style.description(),
                  com.sourceos.style.StyleService.Status.ARCHIVED,
                  0L),
              "release-style-archive");
      case "pattern" ->
          patterns.lifecycle(
              org,
              project.id(),
              style.id(),
              family.id(),
              new com.sourceos.pattern.PatternService.LifecycleInput(
                  com.sourceos.pattern.PatternService.Status.ARCHIVED, 0L),
              "release-pattern-archive");
      case "source-organization", "recipient-organization" ->
          jdbc.sql("UPDATE organization SET status='ARCHIVED',version=version+1 WHERE id=:id")
              .param("id", parent.equals("source-organization") ? org : foreignOrg)
              .update();
      default -> throw new IllegalArgumentException();
    }
    return 200;
  }

  @ParameterizedTest
  @CsvSource({
    "project,true",
    "project,false",
    "style,true",
    "style,false",
    "pattern,true",
    "pattern,false",
    "source-organization,true",
    "source-organization,false",
    "recipient-organization,true",
    "recipient-organization,false"
  })
  void parentArchiveBothOrdersIncludingDatabaseOnlyOrganizationLifecycle(
      String parent, boolean archiveFirst) throws Exception {
    prepare();
    var results =
        archiveFirst
            ? race(() -> archiveParent(parent), this::consume)
            : race(this::consume, () -> archiveParent(parent));
    assertThat(results)
        .containsExactly(
            archiveFirst ? 200 : 201,
            archiveFirst ? (parent.equals("source-organization") ? 403 : 409) : 200);
    assertThat(
            jdbc.sql("SELECT count(*) FROM pattern_release WHERE consent_id=:id")
                .param("id", consent.id())
                .query(Long.class)
                .single())
        .isEqualTo(archiveFirst ? 0 : 1);
  }

  @ParameterizedTest
  @CsvSource({
    "organization,true",
    "organization,false",
    "project,true",
    "project,false",
    "style,true",
    "style,false"
  })
  void actualLegacyMetadataAuditFkAndNewRootPrefixBothOrders(String parent, boolean metadataFirst)
      throws Exception {
    prepare();
    Callable<Integer> change =
        () -> {
          actor(owner);
          switch (parent) {
            case "organization" ->
                organizations.rename(org, "Renamed release source", 0L, "release-rename");
            case "project" ->
                projects.update(
                    org,
                    project.id(),
                    new com.sourceos.project.ProjectService.UpdateInput(
                        "Renamed project",
                        project.description(),
                        com.sourceos.project.ProjectService.Status.ACTIVE,
                        0L),
                    "release-project-update");
            case "style" ->
                styles.update(
                    org,
                    project.id(),
                    style.id(),
                    new com.sourceos.style.StyleService.UpdateInput(
                        style.styleCode(),
                        "Renamed style",
                        style.description(),
                        com.sourceos.style.StyleService.Status.ACTIVE,
                        0L),
                    "release-style-update");
            default -> throw new IllegalArgumentException();
          }
          return 200;
        };
    assertThat(metadataFirst ? race(change, this::consume) : race(this::consume, change))
        .containsExactly(metadataFirst ? 200 : 201, metadataFirst ? 201 : 200);
    String col = parent.equals("organization") ? "source_version" : parent + "_version";
    assertThat(
            jdbc.sql("SELECT " + col + " FROM pattern_release WHERE consent_id=:id")
                .param("id", consent.id())
                .query(Long.class)
                .single())
        .isEqualTo(metadataFirst ? 1 : 0);
  }

  @ParameterizedTest
  @CsvSource({"true", "false"})
  void actualQaWriteAndReleaseRootPrefixBothOrders(boolean qaFirst) throws Exception {
    prepare();
    Callable<Integer> assess =
        () -> {
          actor(owner);
          qa.create(
              org,
              project.id(),
              style.id(),
              family.id(),
              revision,
              new com.sourceos.patternqa.PatternQaModels.Input(
                  0L,
                  com.sourceos.patternqa.PatternQaModels.Outcome.OBSERVED,
                  com.sourceos.patternqa.PatternQaModels.Basis.METADATA_ONLY,
                  null,
                  "Concurrent observation"),
              "release-qa-race");
          return 201;
        };
    assertThat(qaFirst ? race(assess, this::consume) : race(this::consume, assess))
        .containsExactly(201, 201);
  }

  @Test
  void pendingArtifactCannotBecomeImplicitDelayedReviewThenExplicitReadyCreationWorks()
      throws Exception {
    actor(foreignOwner);
    consent = consents.issue(foreignOrg, new ConsentCreateInput(org), "readiness-consent");
    var reserved = new CountDownLatch(1);
    var finish = new CountDownLatch(1);
    writing =
        (o, k, b) -> {
          objects.put(o + "/" + k, b.clone());
          reserved.countDown();
          try {
            if (!finish.await(8, TimeUnit.SECONDS))
              throw new java.io.IOException("barrier timeout");
          } catch (InterruptedException e) {
            throw new java.io.IOException(e);
          }
        };
    try (var worker = Executors.newSingleThreadExecutor()) {
      var upload =
          worker.submit(
              () -> {
                actor(owner);
                return upload();
              });
      assertThat(reserved.await(8, TimeUnit.SECONDS)).isTrue();
      revision =
          jdbc.sql("SELECT pattern_revision_id FROM pattern_artifact WHERE style_id=:style")
              .param("style", style.id())
              .query(UUID.class)
              .single();
      try {
        assertThat(tx(this::consume)).isEqualTo(409);
      } finally {
        finish.countDown();
      }
      assertThat(upload.get(10, TimeUnit.SECONDS).artifact().state().name()).isEqualTo("READY");
      assertThat(tx(this::consume)).isEqualTo(201);
    }
  }

  @Test
  void twoDirectSqlRedemptionsSerializeOnRealRows() throws Exception {
    try (var first =
            DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
        var second =
            DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword())) {
      first.setAutoCommit(false);
      second.setAutoCommit(false);
      var f = PatternReleaseSqlFixture.seed(first, "READY");
      var c = PatternReleaseSqlFixture.consent(first, f);
      first.commit();
      PatternReleaseSqlFixture.release(first, f, c);
      var secondPid = new CompletableFuture<Integer>();
      try (var worker = Executors.newSingleThreadExecutor()) {
        var loser =
            worker.submit(
                () -> {
                  secondPid.complete(
                      (int) PatternReleaseSqlFixture.count(second, "SELECT pg_backend_pid()"));
                  try {
                    PatternReleaseSqlFixture.release(second, f, c);
                    second.commit();
                    return "COMMITTED";
                  } catch (SQLException e) {
                    second.rollback();
                    return e.getSQLState();
                  }
                });
        try {
          blocked(secondPid.get(3, TimeUnit.SECONDS));
        } finally {
          first.commit();
        }
        assertThat(loser.get(10, TimeUnit.SECONDS)).isEqualTo("23514");
      }
      assertThat(
              PatternReleaseSqlFixture.count(
                  first,
                  "SELECT count(*) FROM pattern_release WHERE consent_id="
                      + PatternReleaseSqlFixture.q(c)))
          .isEqualTo(1);
      first.rollback();
    }
  }
}
