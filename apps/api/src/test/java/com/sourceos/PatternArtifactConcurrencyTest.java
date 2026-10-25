package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.web.server.ResponseStatusException;

class PatternArtifactConcurrencyTest extends PatternArtifactSupport {
  @MockitoSpyBean com.sourceos.style.StyleService styleSpy;

  int outcome(Callable<?> c) {
    actor(owner);
    try {
      c.call();
      return 201;
    } catch (ResponseStatusException e) {
      return e.getStatusCode().value();
    } catch (Exception e) {
      throw new RuntimeException(e);
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
    assertThat(blocked).as("actual independent PostgreSQL lock blocking").isTrue();
  }

  @ParameterizedTest
  @ValueSource(strings = {"artifact-artifact", "artifact-metadata", "metadata-artifact"})
  void staleHeadsSerializeWithActualDatabaseBlocking(String mode) throws Exception {
    var held = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var pid = new CompletableFuture<Integer>();
    var secondThread = new java.util.concurrent.atomic.AtomicReference<Thread>();
    var styleTarget =
        AopTestUtils.<com.sourceos.style.StyleService>getUltimateTargetObject(styleSpy);
    doAnswer(
            a -> {
              if (Thread.currentThread() == secondThread.get())
                pid.complete(jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
              return a.callRealMethod();
            })
        .when(styleTarget)
        .lockContextForWrite(eq(org), eq(project.id()), eq(style.id()));
    var auditTarget =
        AopTestUtils.<com.sourceos.audit.AuditRecorder>getUltimateTargetObject(recorder);
    String action =
        mode.startsWith("metadata")
            ? "pattern_revision.created"
            : "pattern_artifact.upload_started";
    doAnswer(
            a -> {
              a.callRealMethod();
              if (Thread.currentThread() != secondThread.get()) {
                held.countDown();
                assertThat(release.await(6, TimeUnit.SECONDS)).isTrue();
              }
              return null;
            })
        .when(auditTarget)
        .organizationChanged(eq(org), eq(action), any(), any(), any(), any(), any());
    var pool = Executors.newFixedThreadPool(2);
    try {
      var first =
          pool.submit(
              () ->
                  outcome(
                      () ->
                          mode.startsWith("metadata")
                              ? patterns.createRevision(
                                  org, project.id(), style.id(), family.id(), next(1), "race-first")
                              : upload()));
      assertThat(held.await(6, TimeUnit.SECONDS)).isTrue();
      var second =
          pool.submit(
              () -> {
                secondThread.set(Thread.currentThread());
                return outcome(
                    () ->
                        mode.endsWith("metadata")
                            ? patterns.createRevision(
                                org, project.id(), style.id(), family.id(), next(1), "race-second")
                            : upload());
              });
      waiting(pid.get(4, TimeUnit.SECONDS));
      release.countDown();
      assertThat(first.get(10, TimeUnit.SECONDS)).isEqualTo(201);
      assertThat(second.get(10, TimeUnit.SECONDS)).isEqualTo(409);
      assertThat(patternCount("pattern_revision")).isEqualTo(2);
      assertThat(events("upload_started")).isEqualTo(mode.startsWith("metadata") ? 0 : 1);
      verify(port, times(mode.startsWith("metadata") ? 0 : 1)).put(any(), any(), any());
    } finally {
      release.countDown();
      pool.shutdownNow();
      assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"project", "style", "pattern", "metadata"})
  void independentWriteDuringStorageRetainsExactHistory(String action) throws Exception {
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    writing =
        (o, k, b) -> {
          entered.countDown();
          try {
            assertThat(release.await(6, TimeUnit.SECONDS)).isTrue();
          } catch (InterruptedException e) {
            throw new IOException(e);
          }
          objects.put(o + "/" + k, b.clone());
        };
    var pool = Executors.newSingleThreadExecutor();
    try {
      var future = pool.submit(() -> outcome(this::upload));
      assertThat(entered.await(6, TimeUnit.SECONDS)).isTrue();
      actor(owner);
      if (action.equals("metadata"))
        patterns.createRevision(
            org, project.id(), style.id(), family.id(), next(2), "concurrent-next");
      else archive(action);
      release.countDown();
      assertThat(future.get(10, TimeUnit.SECONDS)).isEqualTo(action.equals("metadata") ? 201 : 409);
      assertThat(state()).isEqualTo(action.equals("metadata") ? "READY" : "PENDING");
      assertThat(objects).hasSize(1);
      actor(owner);
      assertThat(
              patterns
                  .read(org, project.id(), style.id(), family.id())
                  .latestRevision()
                  .revisionNumber())
          .isEqualTo(action.equals("metadata") ? 3 : 2);
    } finally {
      release.countDown();
      pool.shutdownNow();
      assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }
}
