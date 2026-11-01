package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.pattern.PatternArtifactProbe;
import com.sourceos.pattern.PatternArtifactService;
import com.sourceos.pattern.PatternService;
import com.sourceos.patternrelease.ReleaseModels.*;
import java.io.ByteArrayInputStream;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.server.ResponseStatusException;

class PatternReleaseLifecycleRaceTest extends PatternReleaseIntegrationSupport {
  private int run(Callable<Integer> work) {
    try {
      return transaction()
          .execute(
              s -> {
                jdbc.sql("SET LOCAL lock_timeout='6s'").update();
                try {
                  return work.call();
                } catch (RuntimeException e) {
                  throw e;
                } catch (Exception e) {
                  throw new IllegalStateException(e);
                }
              });
    } catch (ResponseStatusException e) {
      return e.getStatusCode().value();
    }
  }

  private void blocked(int pid) {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    boolean seen = false;
    while (System.nanoTime() < end) {
      if (jdbc.sql("SELECT cardinality(pg_blocking_pids(:pid))>0")
          .param("pid", pid)
          .query(Boolean.class)
          .single()) {
        seen = true;
        break;
      }
      Thread.onSpinWait();
    }
    assertThat(seen).isTrue();
  }

  private List<Integer> race(Callable<Integer> first, Callable<Integer> second) throws Exception {
    var held = new CountDownLatch(1);
    var commit = new CountDownLatch(1);
    var pid = new CompletableFuture<Integer>();
    try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
      var a =
          pool.submit(
              () ->
                  run(
                      () -> {
                        int result = first.call();
                        held.countDown();
                        if (!commit.await(8, TimeUnit.SECONDS))
                          throw new IllegalStateException("race barrier");
                        return result;
                      }));
      assertThat(held.await(8, TimeUnit.SECONDS)).isTrue();
      var b =
          pool.submit(
              () ->
                  run(
                      () -> {
                        pid.complete(
                            jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                        return second.call();
                      }));
      try {
        blocked(pid.get(5, TimeUnit.SECONDS));
      } finally {
        commit.countDown();
      }
      return List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
    } finally {
      commit.countDown();
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"revoke", "withdraw"})
  void simultaneousTerminalCommandsProduceOneEventOneConflict(String command) throws Exception {
    Callable<Integer> operation =
        () -> {
          if (command.equals("revoke")) revoke();
          else withdraw();
          return 200;
        };
    assertThat(race(operation, operation)).containsExactly(200, 409);
    if (command.equals("revoke"))
      assertThat(
              jdbc.sql(
                      "SELECT count(*) FROM pattern_release_event WHERE release_id=:id AND"
                          + " kind='REVOKED'")
                  .param("id", releaseId())
                  .query(Long.class)
                  .single())
          .isEqualTo(1);
    else
      assertThat(
              jdbc.sql(
                      "SELECT count(*) FROM pattern_release_consent_event WHERE consent_id=:id AND"
                          + " kind='WITHDRAWN'")
                  .param("id", receivingConsent.id())
                  .query(Long.class)
                  .single())
          .isEqualTo(1);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void reciprocalRealReleasesUseIdenticalRootOrderBothWinnerOrders(boolean sourceFirst)
      throws Exception {
    actor(foreignOwner);
    var other =
        patterns.create(
            foreignOrg,
            foreignProject.id(),
            foreignStyle.id(),
            new PatternService.CreateInput("Reciprocal Pattern", null, null),
            "reciprocal-pattern");
    var otherReady =
        artifacts.upload(
            foreignOrg,
            foreignProject.id(),
            foreignStyle.id(),
            other.id(),
            new PatternArtifactService.Input(
                1L,
                "Reciprocal artifact",
                null,
                null,
                PatternArtifactProbe.Format.PDF,
                "reciprocal.pdf"),
            () -> new ByteArrayInputStream(pdfBytes()),
            "reciprocal-artifact");
    var toB = consents.issue(foreignOrg, new ConsentCreateInput(org), "to-b");
    actor(owner);
    var toA = consents.issue(org, new ConsentCreateInput(foreignOrg), "to-a");
    Callable<Integer> a =
        () -> {
          actor(owner);
          releases.create(
              org,
              project.id(),
              style.id(),
              family.id(),
              ready.revision().id(),
              new CreateInput(toB.id(), 1L, "A to B", 86400),
              "a-to-b");
          return 201;
        };
    Callable<Integer> b =
        () -> {
          actor(foreignOwner);
          releases.create(
              foreignOrg,
              foreignProject.id(),
              foreignStyle.id(),
              other.id(),
              otherReady.revision().id(),
              new CreateInput(toA.id(), 1L, "B to A", 86400),
              "b-to-a");
          return 201;
        };
    assertThat(sourceFirst ? race(a, b) : race(b, a)).containsExactly(201, 201);
    assertThat(
            jdbc.sql("SELECT count(*) FROM pattern_release WHERE consent_id IN (:ids)")
                .param("ids", List.of(toA.id(), toB.id()))
                .query(Long.class)
                .single())
        .isEqualTo(2);
  }

  @Test
  void sourceMembershipRevokedDuringObservedConsentWaitDeniesActualWriteBoundary()
      throws Exception {
    actor(foreignOwner);
    var consent = consents.issue(foreignOrg, new ConsentCreateInput(org), "membership-race");
    try (var block = independentConnection();
        var pool = Executors.newSingleThreadExecutor()) {
      block.setAutoCommit(false);
      try (var s =
          block.prepareStatement("SELECT id FROM pattern_release_consent WHERE id=? FOR UPDATE")) {
        s.setObject(1, consent.id());
        s.executeQuery().close();
      }
      var pid = new CompletableFuture<Integer>();
      var result =
          pool.submit(
              () -> {
                actor(owner);
                try {
                  return run(
                      () -> {
                        pid.complete(
                            jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                        releases.create(
                            org,
                            project.id(),
                            style.id(),
                            family.id(),
                            ready.revision().id(),
                            new CreateInput(
                                consent.id(), 1L, "Denied after membership loss", 86400),
                            "membership-write");
                        return 201;
                      });
                } catch (org.springframework.security.access.AccessDeniedException denied) {
                  return 403;
                }
              });
      try {
        blocked(pid.get(5, TimeUnit.SECONDS));
        jdbc.sql(
                "UPDATE membership SET status='REVOKED' WHERE organization_id=:org AND"
                    + " subject=:subject")
            .param("org", org)
            .param("subject", owner)
            .update();
      } finally {
        block.commit();
      }
      assertThat(result.get(8, TimeUnit.SECONDS)).isEqualTo(403);
      assertThat(
              jdbc.sql("SELECT count(*) FROM pattern_release WHERE consent_id=:id")
                  .param("id", consent.id())
                  .query(Long.class)
                  .single())
          .isZero();
      actor(foreignOwner);
      assertThat(consents.read(foreignOrg, consent.id()).state()).isEqualTo(ConsentState.ISSUED);
      // Historical source provenance does not impersonate an ongoing source membership.
      assertThat(gateway.download(foreignOrg, releaseId()).bytes()).containsExactly(pdfBytes());
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"revoke", "withdraw"})
  void terminalMutationRechecksMembershipAfterObservedConsentWait(String command) throws Exception {
    UUID actingOrg = command.equals("revoke") ? org : foreignOrg;
    String actingSubject = command.equals("revoke") ? owner : foreignOwner;
    long auditBefore = jdbc.sql("SELECT count(*) FROM audit_event").query(Long.class).single();
    try (var block = independentConnection();
        var pool = Executors.newSingleThreadExecutor()) {
      block.setAutoCommit(false);
      try (var s =
          block.prepareStatement("SELECT id FROM pattern_release_consent WHERE id=? FOR UPDATE")) {
        s.setObject(1, receivingConsent.id());
        s.executeQuery().close();
      }
      var pid = new CompletableFuture<Integer>();
      var result =
          pool.submit(
              () -> {
                actor(actingSubject);
                try {
                  return run(
                      () -> {
                        pid.complete(
                            jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                        if (command.equals("revoke")) revoke();
                        else withdraw();
                        return 200;
                      });
                } catch (org.springframework.security.access.AccessDeniedException denied) {
                  return 403;
                }
              });
      try {
        blocked(pid.get(5, TimeUnit.SECONDS));
        jdbc.sql(
                "UPDATE membership SET status='REVOKED' WHERE organization_id=:org AND"
                    + " subject=:subject")
            .param("org", actingOrg)
            .param("subject", actingSubject)
            .update();
      } finally {
        block.commit();
      }
      assertThat(result.get(8, TimeUnit.SECONDS)).isEqualTo(403);
      assertThat(jdbc.sql("SELECT count(*) FROM audit_event").query(Long.class).single())
          .isEqualTo(auditBefore);
      assertThat(
              jdbc.sql("SELECT count(*) FROM pattern_release_event WHERE release_id=:id")
                  .param("id", releaseId())
                  .query(Long.class)
                  .single())
          .isEqualTo(1);
      assertThat(
              jdbc.sql("SELECT count(*) FROM pattern_release_consent_event WHERE consent_id=:id")
                  .param("id", receivingConsent.id())
                  .query(Long.class)
                  .single())
          .isEqualTo(2);
    }
  }
}
