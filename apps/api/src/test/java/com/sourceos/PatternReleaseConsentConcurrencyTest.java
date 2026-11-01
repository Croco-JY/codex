package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.patternrelease.*;
import com.sourceos.patternrelease.ReleaseModels.*;
import java.time.Duration;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.server.ResponseStatusException;

class PatternReleaseConsentConcurrencyTest extends WorkspaceIntegrationSupport {
  @Autowired ReleaseConsentService consents;

  @Test
  void independentWithdrawalsObserveBlockingOneEventAndOneConflict() throws Exception {
    actor(foreignOwner);
    var v = consents.issue(foreignOrg, new ConsentCreateInput(org), "race-issue");
    var written = new CountDownLatch(1);
    var commit = new CountDownLatch(1);
    var secondStarted = new CountDownLatch(1);
    var pids = new int[2];
    try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
      var first =
          workers.submit(
              () -> {
                actor(foreignOwner);
                return transaction()
                    .execute(
                        status -> {
                          pids[0] =
                              jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single();
                          var next =
                              consents.withdraw(foreignOrg, v.id(), new EventCommand(1L), "winner");
                          written.countDown();
                          try {
                            if (!commit.await(10, TimeUnit.SECONDS))
                              throw new IllegalStateException("barrier timeout");
                          } catch (InterruptedException e) {
                            throw new RuntimeException(e);
                          }
                          return next;
                        });
              });
      assertThat(written.await(10, TimeUnit.SECONDS)).isTrue();
      var second =
          workers.submit(
              () -> {
                actor(foreignOwner);
                try {
                  return transaction()
                      .execute(
                          status -> {
                            pids[1] =
                                jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single();
                            secondStarted.countDown();
                            consents.withdraw(foreignOrg, v.id(), new EventCommand(1L), "loser");
                            return 200;
                          });
                } catch (ResponseStatusException e) {
                  return e.getStatusCode().value();
                }
              });
      assertThat(secondStarted.await(10, TimeUnit.SECONDS)).isTrue();
      boolean blocked = false;
      long until = System.nanoTime() + Duration.ofSeconds(8).toNanos();
      try {
        while (System.nanoTime() < until) {
          blocked =
              jdbc.sql("SELECT :first=ANY(pg_blocking_pids(:second))")
                  .param("first", pids[0])
                  .param("second", pids[1])
                  .query(Boolean.class)
                  .single();
          if (blocked) break;
          Thread.yield();
        }
        assertThat(blocked).as("actual PostgreSQL blocking, not a sleep oracle").isTrue();
      } finally {
        commit.countDown();
      }
      assertThat(first.get(10, TimeUnit.SECONDS).latestEventNumber()).isEqualTo(2);
      assertThat(second.get(10, TimeUnit.SECONDS)).isEqualTo(409);
    }
    assertThat(consents.read(foreignOrg, v.id()).latestEventNumber()).isEqualTo(2);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM pattern_release_consent_event WHERE consent_id=:id AND"
                        + " kind='WITHDRAWN'")
                .param("id", v.id())
                .query(Long.class)
                .single())
        .isEqualTo(1);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM audit_event WHERE entity_id=:id AND"
                        + " action='pattern_release_consent.withdrawn'")
                .param("id", v.id())
                .query(Long.class)
                .single())
        .isEqualTo(1);
  }
}
