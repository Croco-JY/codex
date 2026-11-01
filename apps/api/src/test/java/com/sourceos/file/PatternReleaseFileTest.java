package com.sourceos.file;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.sourceos.PatternReleaseEvidence;
import com.sourceos.PatternReleaseIntegrationSupport;
import com.sourceos.patternrelease.ReleaseModels.*;
import java.nio.ByteBuffer;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.MockedStatic;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.transaction.support.TransactionSynchronizationManager;

// This distinct spy graph owns its pool; do not retain it in the cumulative context cache.
@org.springframework.test.annotation.DirtiesContext(
    classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
class PatternReleaseFileTest extends PatternReleaseIntegrationSupport {
  @MockitoSpyBean(name = "releaseObjectReader")
  ReleaseObjectReader reader;

  @MockitoSpyBean(name = "releaseConsentFacts")
  com.sourceos.patternrelease.ReleaseConsentFactsProvider consentFacts;

  @Test
  void successfulRealDownloadHasSafeHeadersAndExactBytes() throws Exception {
    var response =
        mvc.perform(
                get(recipientPath() + "/content")
                    .header("X-Dev-Subject", foreignOwner)
                    .header("X-Request-ID", "released-content"))
            .andReturn()
            .getResponse();
    assertThat(response.getStatus()).isEqualTo(200);
    assertThat(response.getContentAsByteArray()).containsExactly(pdfBytes());
    assertThat(response.getContentType()).startsWith("application/octet-stream");
    assertThat(response.getHeader("Cache-Control")).isEqualTo("private, no-store");
    assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
    assertThat(response.getHeader("Content-Disposition"))
        .startsWith("attachment;")
        .contains("filename*=");
    assertThat(response.getHeader("Content-Length")).isEqualTo(Integer.toString(pdfBytes().length));
  }

  @ParameterizedTest
  @ValueSource(strings = {"membership", "foreign", "revoked", "withdrawn", "parent"})
  void deniedInitialAuthorizationPerformsZeroStorageReads(String why) {
    if (why.equals("membership")) actor("not-member");
    else if (why.equals("revoked")) revoke();
    else if (why.equals("withdrawn")) withdraw();
    else if (why.equals("parent"))
      jdbc.sql("UPDATE style SET name=name||' edit',version=version+1 WHERE id=:id")
          .param("id", style.id())
          .update();
    if (!why.equals("membership")) actor(foreignOwner);
    assertThatThrownBy(
            () -> gateway.download(foreignOrg, why.equals("foreign") ? id() : releaseId()))
        .isInstanceOf(RuntimeException.class);
    verifyNoInteractions(reader);
  }

  @ParameterizedTest
  @ValueSource(strings = {"missing", "short", "long", "corrupt", "symlink"})
  void storageFailureNeverChangesReadyHistoryAndReturnsNoBinary(String kind) throws Exception {
    Path object = objectPath();
    switch (kind) {
      case "missing" -> Files.delete(object);
      case "short" -> Files.write(object, new byte[] {1});
      case "long" -> Files.write(object, new byte[pdfBytes().length + 1]);
      case "corrupt" -> {
        byte[] bytes = pdfBytes();
        bytes[0] ^= 1;
        Files.write(object, bytes);
      }
      case "symlink" -> {
        Path outside = Files.createTempFile("release-symlink-target-", ".bin");
        Files.write(outside, pdfBytes());
        Files.delete(object);
        Files.createSymbolicLink(object, outside);
      }
      default -> throw new IllegalArgumentException();
    }
    assertThatThrownBy(() -> gateway.download(foreignOrg, releaseId()))
        .isInstanceOfSatisfying(
            org.springframework.web.server.ResponseStatusException.class,
            e -> assertThat(e.getStatusCode().value()).isEqualTo(409));
    assertThat(
            jdbc.sql("SELECT state FROM pattern_artifact WHERE id=:id")
                .param("id", ready.artifact().id())
                .query(String.class)
                .single())
        .isEqualTo("READY");
    assertThat(
            jdbc.sql("SELECT count(*) FROM pattern_release WHERE id=:id")
                .param("id", releaseId())
                .query(Long.class)
                .single())
        .isEqualTo(1);
  }

  @Test
  void sparseHostileObjectReadsOnlyExpectedPlusOneAndAllocatesBoundedly() throws Exception {
    try (var file = new java.io.RandomAccessFile(objectPath().toFile(), "rw")) {
      file.setLength(8L * 1024 * 1024 * 1024);
    }
    var observed = new ArrayList<ByteBuffer>();
    try (MockedStatic<ByteBuffer> hook = mockStatic(ByteBuffer.class, CALLS_REAL_METHODS)) {
      hook.when(() -> ByteBuffer.wrap(any(byte[].class)))
          .thenAnswer(
              invocation -> {
                var buffer = (ByteBuffer) invocation.callRealMethod();
                if (StackWalker.getInstance()
                    .walk(
                        frames ->
                            frames.anyMatch(
                                f ->
                                    f.getClassName().equals(SecureBoundedObjects.class.getName()))))
                  observed.add(buffer);
                return buffer;
              });
      assertThatThrownBy(() -> gateway.download(foreignOrg, releaseId()))
          .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
    assertThat(observed).hasSize(1);
    assertThat(observed.getFirst().capacity()).isEqualTo(pdfBytes().length + 1);
    assertThat(observed.getFirst().position()).isEqualTo(pdfBytes().length + 1);
    PatternReleaseEvidence.write(
        "bounded-sparse",
        Map.of(
            "physicalSparseSize",
            8L * 1024 * 1024 * 1024,
            "declaredSize",
            pdfBytes().length,
            "allocatedReadBuffer",
            observed.getFirst().capacity(),
            "actualBytesRead",
            observed.getFirst().position(),
            "binaryReturned",
            false));
  }

  @Test
  void exactlyTenMiBAndDetectionByteAreBounded() throws Exception {
    byte[] max = new byte[AuthorizedStorage.MAX_BYTES];
    Arrays.fill(max, (byte) ' ');
    System.arraycopy(
        "%PDF-1.4\n".getBytes(java.nio.charset.StandardCharsets.US_ASCII), 0, max, 0, 9);
    byte[] end = "\n%%EOF\n".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    System.arraycopy(end, 0, max, max.length - end.length, end.length);
    actor(owner);
    var next =
        artifacts.upload(
            org,
            project.id(),
            style.id(),
            family.id(),
            new com.sourceos.pattern.PatternArtifactService.Input(
                2L,
                "Maximum revision",
                null,
                null,
                com.sourceos.pattern.PatternArtifactProbe.Format.PDF,
                "maximum.pdf"),
            () -> new java.io.ByteArrayInputStream(max),
            "maximum");
    actor(foreignOwner);
    var c = consents.issue(foreignOrg, new ConsentCreateInput(org), "max-consent");
    actor(owner);
    var released =
        releases.create(
            org,
            project.id(),
            style.id(),
            family.id(),
            next.revision().id(),
            new CreateInput(c.id(), 1L, "Max bytes", 86400),
            "max-release");
    actor(foreignOwner);
    var observed = new ArrayList<ByteBuffer>();
    try (MockedStatic<ByteBuffer> hook = mockStatic(ByteBuffer.class, CALLS_REAL_METHODS)) {
      hook.when(() -> ByteBuffer.wrap(any(byte[].class)))
          .thenAnswer(
              invocation -> {
                var b = (ByteBuffer) invocation.callRealMethod();
                if (StackWalker.getInstance()
                    .walk(
                        frames ->
                            frames.anyMatch(
                                f ->
                                    f.getClassName().equals(SecureBoundedObjects.class.getName()))))
                  observed.add(b);
                return b;
              });
      assertThat(gateway.download(foreignOrg, released.release().id()).bytes())
          .containsExactly(max);
      Path object =
          Path.of(
              "/tmp/source-supply-test-storage",
              org.toString(),
              jdbc.sql("SELECT storage_object_id FROM pattern_release WHERE id=:id")
                  .param("id", released.release().id())
                  .query(UUID.class)
                  .single()
                  .toString());
      Files.write(object, new byte[] {1}, StandardOpenOption.APPEND);
      assertThatThrownBy(() -> gateway.download(foreignOrg, released.release().id()))
          .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
    assertThat(observed).hasSize(2);
    assertThat(observed)
        .allSatisfy(b -> assertThat(b.capacity()).isEqualTo(AuthorizedStorage.MAX_BYTES + 1));
    assertThat(observed.get(0).position()).isEqualTo(AuthorizedStorage.MAX_BYTES);
    assertThat(observed.get(1).position()).isEqualTo(AuthorizedStorage.MAX_BYTES + 1);
    PatternReleaseEvidence.write(
        "bounded-maximum",
        Map.of(
            "declaredBytes",
            max.length,
            "allocatedBuffer",
            observed.getFirst().capacity(),
            "validBytesRead",
            observed.getFirst().position(),
            "oversizedBytesRead",
            observed.get(1).position()));
  }

  @ParameterizedTest
  @ValueSource(strings = {"organization", "ancestor", "root"})
  void noFollowAnchoredDirectoryOpeningRejectsSymlinkParents(String which) throws Exception {
    var binding = authorizer.authorize(foreignOrg, releaseId());
    Path root = Files.createTempDirectory("release-safe-root-");
    Path elsewhere = Files.createTempDirectory("release-outside-");
    Files.createDirectories(elsewhere.resolve(org.toString()));
    Files.write(elsewhere.resolve(org.toString()).resolve(objectId().toString()), pdfBytes());
    Path configured = root;
    if (which.equals("organization"))
      Files.createSymbolicLink(root.resolve(org.toString()), elsewhere.resolve(org.toString()));
    else if (which.equals("root")) {
      Path link = root.resolve("linked-root");
      Files.createSymbolicLink(link, elsewhere);
      configured = link;
    } else {
      Path link = root.resolve("parent");
      Files.createSymbolicLink(link, elsewhere);
      configured = link.resolve("nested");
      Files.createDirectories(elsewhere.resolve("nested").resolve(org.toString()));
      Files.write(
          elsewhere.resolve("nested").resolve(org.toString()).resolve(objectId().toString()),
          pdfBytes());
    }
    var adapter = new LocalStorageAdapter(configured.toString());
    assertThatThrownBy(() -> adapter.readBounded(binding)).isInstanceOf(java.io.IOException.class);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "revoke",
        "withdraw",
        "membership",
        "source",
        "recipient",
        "project",
        "style",
        "pattern"
      })
  void heldPhysicalStorageThenCommittedDenialBeforeFinalSnapshotReturnsNoBytes(String change)
      throws Exception {
    var reading = new CountDownLatch(1);
    var complete = new CountDownLatch(1);
    doAnswer(
            invocation -> {
              assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
              try (var observer = independentConnection()) {
                observer.setAutoCommit(false);
                try (var query = observer.createStatement();
                    var rows =
                        query.executeQuery(
                            "SELECT count(*) FROM pg_stat_activity WHERE backend_type='client"
                                + " backend' AND datname=current_database() AND"
                                + " pid<>pg_backend_pid() AND (state<>'idle' OR xact_start IS NOT"
                                + " NULL)")) {
                  rows.next();
                  assertThat(rows.getLong(1)).isZero();
                }
                for (var fact :
                    List.of(
                        Map.entry("organization", org),
                        Map.entry("organization", foreignOrg),
                        Map.entry("project", project.id()),
                        Map.entry("style", style.id()),
                        Map.entry("pattern", family.id()))) {
                  try (var query =
                      observer.prepareStatement(
                          "SELECT id FROM "
                              + fact.getKey()
                              + " WHERE id=? FOR NO KEY UPDATE NOWAIT")) {
                    query.setObject(1, fact.getValue());
                    try (var rows = query.executeQuery()) {
                      assertThat(rows.next()).isTrue();
                    }
                  }
                }
                observer.rollback();
              }
              reading.countDown();
              if (!complete.await(8, TimeUnit.SECONDS))
                throw new IllegalStateException("storage barrier timeout");
              return invocation.callRealMethod();
            })
        .when(reader)
        .readBounded(any());
    try (var pool = Executors.newSingleThreadExecutor()) {
      var response =
          pool.submit(
              () -> {
                actor(foreignOwner);
                try {
                  gateway.download(foreignOrg, releaseId());
                  return "BYTES";
                } catch (RuntimeException denied) {
                  return "DENIED";
                }
              });
      assertThat(reading.await(8, TimeUnit.SECONDS)).isTrue();
      try {
        if (change.equals("revoke")) revoke();
        else if (change.equals("withdraw")) withdraw();
        else if (change.equals("membership"))
          jdbc.sql(
                  "UPDATE membership SET status='REVOKED' WHERE organization_id=:org AND"
                      + " subject=:subject")
              .param("org", foreignOrg)
              .param("subject", foreignOwner)
              .update();
        else {
          String table =
              change.equals("source") || change.equals("recipient") ? "organization" : change;
          UUID key =
              change.equals("source")
                  ? org
                  : change.equals("recipient")
                      ? foreignOrg
                      : change.equals("project")
                          ? project.id()
                          : change.equals("style") ? style.id() : family.id();
          if (change.equals("pattern")) {
            actor(owner);
            patterns.lifecycle(
                org,
                project.id(),
                style.id(),
                family.id(),
                new com.sourceos.pattern.PatternService.LifecycleInput(
                    com.sourceos.pattern.PatternService.Status.ARCHIVED, 0L),
                "held-parent");
          } else
            jdbc.sql(
                    "UPDATE " + table + " SET name=name||' changed',version=version+1 WHERE id=:id")
                .param("id", key)
                .update();
        }
      } finally {
        complete.countDown();
      }
      assertThat(response.get(10, TimeUnit.SECONDS)).isEqualTo("DENIED");
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"storage", "final-snapshot"})
  void expiryUsesFreshDatabaseWallClockAfterStorageOrFinalSnapshot(String phase) throws Exception {
    actor(foreignOwner);
    var consent = consents.issue(foreignOrg, new ConsentCreateInput(org), "expiry-in-flight");
    actor(owner);
    var shortGrant =
        releases.create(
            org,
            project.id(),
            style.id(),
            family.id(),
            ready.revision().id(),
            new CreateInput(consent.id(), 1L, "Real in-flight deadline", 1),
            "expiry-release");
    actor(foreignOwner);
    Runnable expire =
        () -> {
          long bound = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
          boolean expired = false;
          while (System.nanoTime() < bound) {
            if (jdbc.sql("SELECT clock_timestamp()>=expires_at FROM pattern_release WHERE id=:id")
                .param("id", shortGrant.release().id())
                .query(Boolean.class)
                .single()) {
              expired = true;
              break;
            }
            Thread.onSpinWait();
          }
          assertThat(expired).isTrue();
        };
    if (phase.equals("storage"))
      doAnswer(
              i -> {
                assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
                expire.run();
                return i.callRealMethod();
              })
          .when(reader)
          .readBounded(any());
    else {
      var count = new java.util.concurrent.atomic.AtomicInteger();
      doAnswer(
              i -> {
                var facts = i.callRealMethod();
                if (count.incrementAndGet() == 2) {
                  assertThat(TransactionSynchronizationManager.isCurrentTransactionReadOnly())
                      .isTrue();
                  expire.run();
                }
                return facts;
              })
          .when(
              AopTestUtils
                  .<com.sourceos.patternrelease.ReleaseConsentFactsProvider>getUltimateTargetObject(
                      consentFacts))
          .read(anyList());
    }
    assertThatThrownBy(() -> gateway.download(foreignOrg, shortGrant.release().id()))
        .isInstanceOf(RuntimeException.class);
    assertThat(authorizer.inspectRecipient(foreignOrg, shortGrant.release().id()).effectiveState())
        .isEqualTo("EXPIRED");
  }

  @Test
  void actorCannotChangeBetweenStorageAndFinalDecision() throws Exception {
    doAnswer(
            i -> {
              var bytes = i.callRealMethod();
              actor(owner);
              return bytes;
            })
        .when(reader)
        .readBounded(any());
    assertThatThrownBy(() -> gateway.download(foreignOrg, releaseId()))
        .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
  }

  @ParameterizedTest
  @ValueSource(strings = {"object", "organization"})
  void substitutionBetweenPreflightAndOpenCannotFollowAttackerPath(String race) throws Exception {
    Path organization = objectPath().getParent(),
        parked = organization.resolveSibling(organization.getFileName() + "-parked");
    Path elsewhere = Files.createTempDirectory("release-race-target-");
    Files.write(elsewhere.resolve(objectId().toString()), pdfBytes());
    var replaced = new java.util.concurrent.atomic.AtomicBoolean();
    try (MockedStatic<Files> hook = mockStatic(Files.class, CALLS_REAL_METHODS)) {
      hook.when(() -> Files.newDirectoryStream(any(Path.class)))
          .thenAnswer(
              i ->
                  anchoredRaceProxy(
                      (SecureDirectoryStream<Path>) i.callRealMethod(),
                      () -> {
                        if (replaced.compareAndSet(false, true)) {
                          if (race.equals("object")) {
                            Files.delete(objectPath());
                            Files.createSymbolicLink(
                                objectPath(), elsewhere.resolve(objectId().toString()));
                          } else {
                            Files.move(organization, parked);
                            Files.createSymbolicLink(organization, elsewhere);
                          }
                        }
                      }));
      if (race.equals("object"))
        assertThatThrownBy(() -> gateway.download(foreignOrg, releaseId()))
            .isInstanceOf(RuntimeException.class);
      else
        assertThat(gateway.download(foreignOrg, releaseId()).bytes()).containsExactly(pdfBytes());
    } finally {
      if (race.equals("organization") && Files.isSymbolicLink(organization)) {
        Files.delete(organization);
        Files.move(parked, organization);
      }
    }
    assertThat(replaced).isTrue();
    PatternReleaseEvidence.write(
        "bounded-preflight-open-substitution-" + race,
        Map.of(
            "replacementExecuted",
            true,
            "result",
            race.equals("object") ? "NOFOLLOW_DENIED" : "ANCHORED_ORIGINAL_CONTENT"));
  }

  @SuppressWarnings("unchecked")
  private SecureDirectoryStream<Path> anchoredRaceProxy(
      SecureDirectoryStream<Path> stream, ThrowingAction beforeOpen) {
    return (SecureDirectoryStream<Path>)
        java.lang.reflect.Proxy.newProxyInstance(
            getClass().getClassLoader(),
            new Class<?>[] {SecureDirectoryStream.class},
            (proxy, method, args) -> {
              try {
                if (method.getName().equals("newByteChannel")) beforeOpen.run();
                Object result = method.invoke(stream, args);
                return result instanceof SecureDirectoryStream<?> child
                    ? anchoredRaceProxy((SecureDirectoryStream<Path>) child, beforeOpen)
                    : result;
              } catch (java.lang.reflect.InvocationTargetException failure) {
                throw failure.getCause();
              }
            });
  }

  @FunctionalInterface
  private interface ThrowingAction {
    void run() throws Exception;
  }
}
