package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.sourceos.authorization.*;
import com.sourceos.organization.ReleaseOrganizationFactsProvider;
import com.sourceos.pattern.ReleaseParentFactsProvider;
import com.sourceos.patternrelease.*;
import com.sourceos.project.ReleaseProjectFactsProvider;
import com.sourceos.style.ReleaseStyleFactsProvider;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Test-only catalog oracle; production authorization never polls pg_locks. */
// This distinct spy graph owns its pool; do not retain it in the cumulative context cache.
@org.springframework.test.annotation.DirtiesContext(
    classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
class PatternReleaseSnapshotTest extends PatternReleaseIntegrationSupport {
  @MockitoSpyBean(name = "membershipAccess")
  MembershipLookup membershipAccess;

  @MockitoSpyBean(name = "releaseAccessFacts")
  ReleaseAccessFactsProvider access;

  @MockitoSpyBean(name = "releaseOrganizationFacts")
  ReleaseOrganizationFactsProvider roots;

  @MockitoSpyBean(name = "releaseConsentFacts")
  ReleaseConsentFactsProvider consentFacts;

  @MockitoSpyBean(name = "releaseParentFacts")
  ReleaseParentFactsProvider parentFacts;

  @MockitoSpyBean ReleaseProjectFactsProvider projectFacts;
  @MockitoSpyBean ReleaseStyleFactsProvider styleFacts;
  @MockitoSpyBean JdbcClient client;

  @MockitoSpyBean(name = "transactionManager")
  org.springframework.transaction.PlatformTransactionManager manager;

  private final List<Map<String, Object>> observations = new ArrayList<>();

  @Test
  void samePidAndSnapshotDoNotIdentifyTheSamePhysicalReadOnlyTransaction() throws Exception {
    var samples = new ArrayList<Map<String, String>>();
    try (var c = independentConnection()) {
      c.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ);
      c.setReadOnly(true);
      c.setAutoCommit(false);
      for (int i = 0; i < 2; i++) {
        try (var statement = c.createStatement();
            var r =
                statement.executeQuery(
                    "SELECT pg_backend_pid()::text,pg_current_snapshot()::text,(SELECT virtualxid"
                        + " FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='virtualxid' AND"
                        + " mode='ExclusiveLock' AND granted)")) {
          r.next();
          samples.add(
              Map.of(
                  "pid", r.getString(1), "snapshot", r.getString(2), "virtualxid", r.getString(3)));
        }
        c.commit();
      }
    }
    assertThat(samples.get(0).get("pid")).isEqualTo(samples.get(1).get("pid"));
    assertThat(samples.get(0).get("snapshot")).isEqualTo(samples.get(1).get("snapshot"));
    assertThat(samples.get(0).get("virtualxid")).isNotEqualTo(samples.get(1).get("virtualxid"));
    PatternReleaseEvidence.write("F01-same-session-snapshot-control", samples);
  }

  @Test
  void revokeCommittedAfterSpringBeginButBeforeFirstFinalSnapshotIsObserved() {
    var owners = new AtomicInteger();
    doAnswer(
            i -> {
              var status = i.callRealMethod();
              org.springframework.transaction.TransactionDefinition definition = i.getArgument(0);
              if (definition != null
                  && definition.isReadOnly()
                  && definition.getIsolationLevel()
                      == java.sql.Connection.TRANSACTION_REPEATABLE_READ
                  && owners.incrementAndGet() == 2) {
                try (var worker = Executors.newSingleThreadExecutor()) {
                  worker.submit(this::revoke).get(8, TimeUnit.SECONDS);
                }
              }
              return status;
            })
        .when(manager)
        .getTransaction(any());
    assertThatThrownBy(() -> gateway.download(foreignOrg, releaseId()))
        .isInstanceOf(RuntimeException.class);
    assertThat(owners).hasValue(2);
    PatternReleaseEvidence.write(
        "F01-revoke-before-first-final-snapshot",
        Map.of(
            "springTransactionsStarted",
            owners.get(),
            "committedRevokeBeforeAuthorizerFirstSelect",
            true,
            "binaryReturned",
            false));
  }

  private void observe(String participant) {
    assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
    var sample =
        new LinkedHashMap<String, Object>(
            jdbc.sql(
                    "SELECT pg_backend_pid() AS pid,pg_current_snapshot()::text AS snapshot,(SELECT"
                        + " virtualxid FROM pg_locks WHERE pid=pg_backend_pid() AND"
                        + " locktype='virtualxid' AND mode='ExclusiveLock' AND granted) AS"
                        + " physical_transaction,current_setting('transaction_isolation') AS"
                        + " isolation,current_setting('transaction_read_only') AS"
                        + " read_only,transaction_timestamp()::text AS"
                        + " started,clock_timestamp()::text AS observed")
                .query()
                .singleRow());
    sample.put("participant", participant);
    observations.add(sample);
  }

  private void oracle() {
    doAnswer(
            i -> {
              observe("membership");
              return i.callRealMethod();
            })
        .when(membershipAccess)
        .role(any(), any());
    doAnswer(
            i -> {
              observe("release");
              return i.callRealMethod();
            })
        .when(AopTestUtils.<ReleaseAccessFactsProvider>getUltimateTargetObject(access))
        .recipient(any(), any(), any());
    doAnswer(
            i -> {
              observe("organizations");
              return i.callRealMethod();
            })
        .when(AopTestUtils.<ReleaseOrganizationFactsProvider>getUltimateTargetObject(roots))
        .read(anyList());
    doAnswer(
            i -> {
              observe("consent");
              return i.callRealMethod();
            })
        .when(AopTestUtils.<ReleaseConsentFactsProvider>getUltimateTargetObject(consentFacts))
        .read(anyList());
    doAnswer(
            i -> {
              observe("pattern-revision-artifact");
              return i.callRealMethod();
            })
        .when(AopTestUtils.<ReleaseParentFactsProvider>getUltimateTargetObject(parentFacts))
        .read(anyList());
    doAnswer(
            i -> {
              observe("style");
              return i.callRealMethod();
            })
        .when(AopTestUtils.<ReleaseStyleFactsProvider>getUltimateTargetObject(styleFacts))
        .read(anyList());
    doAnswer(
            i -> {
              observe("project");
              return i.callRealMethod();
            })
        .when(AopTestUtils.<ReleaseProjectFactsProvider>getUltimateTargetObject(projectFacts))
        .read(anyList());
    doAnswer(
            i -> {
              if (i.getArgument(0).equals("SELECT clock_timestamp()")) observe("final-wall-clock");
              return i.callRealMethod();
            })
        .when(client)
        .sql(anyString());
  }

  @Test
  void allProvidersShareTwoDistinctPhysicalSnapshotsBeforeAndAfterStorage() {
    oracle();
    assertThat(gateway.download(foreignOrg, releaseId()).bytes()).containsExactly(pdfBytes());
    var groups = new LinkedHashMap<Object, List<Map<String, Object>>>();
    for (var sample : observations)
      groups
          .computeIfAbsent(sample.get("physical_transaction"), k -> new ArrayList<>())
          .add(sample);
    assertThat(groups).hasSize(2);
    for (var group : groups.values()) {
      assertThat(group.stream().map(o -> o.get("participant")))
          .containsExactlyInAnyOrder(
              "membership",
              "release",
              "organizations",
              "consent",
              "pattern-revision-artifact",
              "style",
              "project",
              "final-wall-clock");
      for (String key : List.of("pid", "snapshot", "started"))
        assertThat(group.stream().map(o -> o.get(key)).distinct()).hasSize(1);
      assertThat(group)
          .allSatisfy(
              o -> {
                assertThat(o.get("isolation")).isEqualTo("repeatable read");
                assertThat(o.get("read_only")).isEqualTo("on");
              });
    }
    PatternReleaseEvidence.write("F01-provider-physical-snapshots", observations);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "withdraw",
        "revoke",
        "membership",
        "source",
        "recipient",
        "project",
        "style",
        "pattern"
      })
  void commitsAfterFinalSnapshotCannotSplitLaterProviderFacts(String change) {
    var target = AopTestUtils.<ReleaseOrganizationFactsProvider>getUltimateTargetObject(roots);
    var calls = new AtomicInteger();
    doAnswer(
            i -> {
              if (calls.incrementAndGet() == 2) {
                observe("final-before-change");
                try (var pool = Executors.newSingleThreadExecutor()) {
                  pool.submit(
                          () -> {
                            if (change.equals("withdraw")) withdraw();
                            else if (change.equals("revoke")) revoke();
                            else if (change.equals("membership"))
                              jdbc.sql(
                                      "UPDATE membership SET status='REVOKED' WHERE"
                                          + " organization_id=:org AND subject=:subject")
                                  .param("org", foreignOrg)
                                  .param("subject", foreignOwner)
                                  .update();
                            else {
                              String table =
                                  change.equals("source") || change.equals("recipient")
                                      ? "organization"
                                      : change;
                              UUID id =
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
                                    "snapshot-change");
                              } else
                                jdbc.sql(
                                        "UPDATE "
                                            + table
                                            + " SET name=name||' changed',version=version+1 WHERE"
                                            + " id=:id")
                                    .param("id", id)
                                    .update();
                            }
                          })
                      .get(8, TimeUnit.SECONDS);
                }
                observe("final-after-change");
              }
              return i.callRealMethod();
            })
        .when(target)
        .read(anyList());
    assertThat(gateway.download(foreignOrg, releaseId()).bytes()).containsExactly(pdfBytes());
    assertThat(observations).hasSize(2);
    assertThat(observations.getFirst().get("physical_transaction"))
        .isEqualTo(observations.getLast().get("physical_transaction"));
    assertThat(observations.getFirst().get("snapshot"))
        .isEqualTo(observations.getLast().get("snapshot"));
    assertThatThrownBy(() -> gateway.download(foreignOrg, releaseId()))
        .isInstanceOf(RuntimeException.class);
    PatternReleaseEvidence.write("F01-after-snapshot-" + change, observations);
  }
}
