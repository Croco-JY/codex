package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.patternrelease.ReleaseModels.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.LockSupport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

/** Real fixed 15-minute production policy. No test clock, TTL override or trigger bypass. */
class PatternReleaseExpiryTest extends PatternReleaseIntegrationSupport {
  private Instant wall() {
    return jdbc.sql("SELECT clock_timestamp()")
        .query((r, n) -> r.getTimestamp(1).toInstant())
        .single();
  }

  private void until(Instant deadline) {
    while (wall().isBefore(deadline)) {
      LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(100));
      if (Thread.interrupted()) throw new IllegalStateException("expiry wait interrupted");
    }
  }

  @Test
  @Timeout(value = 17, unit = TimeUnit.MINUTES)
  void actualConsentDeadlineAfterObservedLockWaitAndConsumedConsentExpiry() throws Exception {
    actor(foreignOwner);
    var expiring = consents.issue(foreignOrg, new ConsentCreateInput(org), "expiry-consent");
    assertThat(Duration.between(expiring.issuedAt(), expiring.expiresAt()))
        .isEqualTo(Duration.ofMinutes(15));
    actor(owner);
    // The release and consent deadlines are independently enforced. Exercise a real short release
    // first.
    actor(foreignOwner);
    var c = consents.issue(foreignOrg, new ConsentCreateInput(org), "short-consent");
    actor(owner);
    var shortGrant =
        releases.create(
            org,
            project.id(),
            style.id(),
            family.id(),
            ready.revision().id(),
            new CreateInput(c.id(), 1L, "Short access", 1),
            "short-release");
    actor(foreignOwner);
    until(shortGrant.release().expiresAt());
    assertThat(authorizer.inspectRecipient(foreignOrg, shortGrant.release().id()).effectiveState())
        .isEqualTo("EXPIRED");
    assertThatThrownBy(() -> gateway.download(foreignOrg, shortGrant.release().id()))
        .isInstanceOf(RuntimeException.class);
    // Wait on the actual database wall clock, preserving every immutable row and policy constant.
    until(expiring.expiresAt().minusSeconds(2));
    try (var blocker = independentConnection();
        var pool = Executors.newSingleThreadExecutor()) {
      blocker.setAutoCommit(false);
      try (var lock =
          blocker.prepareStatement(
              "SELECT id FROM pattern_release_consent WHERE id=? FOR UPDATE")) {
        lock.setObject(1, expiring.id());
        try (var row = lock.executeQuery()) {
          assertThat(row.next()).isTrue();
        }
      }
      int blockerPid;
      try (var s = blocker.createStatement();
          var r = s.executeQuery("SELECT pg_backend_pid()")) {
        r.next();
        blockerPid = r.getInt(1);
      }
      var writerPid = new AtomicInteger();
      var result =
          pool.submit(
              () -> {
                actor(owner);
                try {
                  return transaction()
                      .execute(
                          status -> {
                            writerPid.set(
                                jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                            releases.create(
                                org,
                                project.id(),
                                style.id(),
                                family.id(),
                                ready.revision().id(),
                                new CreateInput(
                                    expiring.id(), 1L, "Must expire after lock wait", 86400),
                                "expired-release");
                            return 201;
                          });
                } catch (org.springframework.web.server.ResponseStatusException denied) {
                  return denied.getStatusCode().value();
                }
              });
      long bound = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      boolean observed = false;
      while (System.nanoTime() < bound) {
        if (writerPid.get() != 0
            && jdbc.sql("SELECT :blocker=ANY(pg_blocking_pids(:writer))")
                .param("blocker", blockerPid)
                .param("writer", writerPid.get())
                .query(Boolean.class)
                .single()) {
          observed = true;
          break;
        }
        Thread.onSpinWait();
      }
      assertThat(observed).isTrue();
      var started =
          jdbc.sql("SELECT xact_start FROM pg_stat_activity WHERE pid=:pid")
              .param("pid", writerPid.get())
              .query((r, n) -> r.getTimestamp(1).toInstant())
              .single();
      assertThat(started).isBefore(expiring.expiresAt());
      until(expiring.expiresAt());
      Instant released = wall();
      blocker.commit();
      assertThat(result.get(8, TimeUnit.SECONDS)).isEqualTo(409);
      actor(foreignOwner);
      assertThat(consents.read(foreignOrg, expiring.id()).state()).isEqualTo(ConsentState.EXPIRED);
      assertThat(
              jdbc.sql("SELECT count(*) FROM pattern_release WHERE consent_id=:id")
                  .param("id", expiring.id())
                  .query(Long.class)
                  .single())
          .isZero();
      // A previously consumed consent's redemption TTL does not shorten its already-issued 24h
      // grant.
      assertThat(wall()).isAfter(receivingConsent.expiresAt());
      assertThat(gateway.download(foreignOrg, releaseId()).bytes()).containsExactly(pdfBytes());
      PatternReleaseEvidence.write(
          "expiry-real-15-minute-lock-wait",
          Map.of(
              "consentIssued",
              expiring.issuedAt().toString(),
              "consentDeadline",
              expiring.expiresAt().toString(),
              "transactionStarted",
              started.toString(),
              "lockReleased",
              released.toString(),
              "writerPid",
              writerPid.get(),
              "blockingPid",
              blockerPid,
              "result",
              409,
              "partialReleaseRows",
              0,
              "consumedConsentExpiredButReleaseStillAccessible",
              true));
    }
  }
}
