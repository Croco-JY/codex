package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.stylefacilitycandidate.StyleFacilityCandidateService;
import com.sourceos.stylematerialselection.StyleMaterialSelectionService;
import com.sourceos.stylerequirement.StyleRequirementService;
import java.util.concurrent.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.core.context.SecurityContextHolder;

class PhaseTwoCumulativeConcurrencyTest extends PhaseTwoCumulativeSupport {
  @ParameterizedTest
  @ValueSource(strings = {"selection", "candidate", "reference"})
  void differentChildFamiliesSerializeOnTheSameProjectStyleSpine(String family) throws Exception {
    var held = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var pid = new CompletableFuture<Integer>();
    var ex = Executors.newFixedThreadPool(2);
    long before = audits();
    try {
      var first =
          ex.submit(
              () -> {
                actor(owner);
                try {
                  return transaction()
                      .execute(
                          t -> {
                            jdbc.sql("SET LOCAL lock_timeout='6s'").update();
                            requirements.write(
                                org,
                                project.id(),
                                style.id(),
                                new StyleRequirementService.Input(
                                    "Synthetic concurrent target",
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    0L),
                                null,
                                "cumulative-first");
                            held.countDown();
                            try {
                              assertThat(release.await(8, TimeUnit.SECONDS)).isTrue();
                            } catch (InterruptedException e) {
                              throw new RuntimeException(e);
                            }
                            return 200;
                          });
                } finally {
                  SecurityContextHolder.clearContext();
                }
              });
      assertThat(held.await(8, TimeUnit.SECONDS)).isTrue();
      var second =
          ex.submit(
              () -> {
                actor(owner);
                try {
                  return transaction()
                      .execute(
                          t -> {
                            jdbc.sql("SET LOCAL lock_timeout='6s'").update();
                            pid.complete(
                                jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                            switch (family) {
                              case "selection" ->
                                  selections.add(
                                      org,
                                      project.id(),
                                      style.id(),
                                      new StyleMaterialSelectionService.Input(material, null, null),
                                      "cumulative-second");
                              case "candidate" ->
                                  candidates.add(
                                      org,
                                      project.id(),
                                      style.id(),
                                      new StyleFacilityCandidateService.Input(otherFacility),
                                      "cumulative-second");
                              case "reference" ->
                                  references.detach(
                                      org,
                                      project.id(),
                                      style.id(),
                                      reference.id(),
                                      1,
                                      "cumulative-second");
                              default -> throw new IllegalArgumentException();
                            }
                            return 200;
                          });
                } finally {
                  SecurityContextHolder.clearContext();
                }
              });
      int waitingPid = pid.get(4, TimeUnit.SECONDS);
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
      boolean blocked = false;
      while (System.nanoTime() < deadline) {
        blocked =
            jdbc.sql("SELECT cardinality(pg_blocking_pids(:pid))>0")
                .param("pid", waitingPid)
                .query(Boolean.class)
                .single();
        if (blocked) break;
        Thread.sleep(10);
      }
      assertThat(blocked)
          .as("independent PostgreSQL child writer actually waits on parent lock")
          .isTrue();
      release.countDown();
      assertThat(first.get(10, TimeUnit.SECONDS)).isEqualTo(200);
      assertThat(second.get(10, TimeUnit.SECONDS)).isEqualTo(200);
      assertThat(audits()).isEqualTo(before + 2);
      actor(owner);
      assertThat(requirements.read(org, project.id(), style.id()).version()).isEqualTo(1);
      assertThat(projects.read(org, project.id()).version()).isZero();
      assertThat(styles.read(org, project.id(), style.id()).version()).isZero();
    } finally {
      release.countDown();
      ex.shutdownNow();
      assertThat(ex.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }
}
