package com.sourceos.authorization;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.sourceos.PatternReleaseEvidence;
import com.sourceos.PatternReleaseIntegrationSupport;
import com.sourceos.pattern.ReleaseParentFactsProvider;
import com.sourceos.patternrelease.ReleaseAccessFactsProvider;
import java.sql.Connection;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.datasource.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.transaction.*;
import org.springframework.transaction.interceptor.TransactionAspectSupport;
import org.springframework.transaction.support.*;

/** Production boundary faults, applied to the fixed real provider after physical storage. */
// This distinct spy graph owns its pool; do not retain it in the cumulative context cache.
@org.springframework.test.annotation.DirtiesContext(
    classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
class PatternReleaseTransactionTest extends PatternReleaseIntegrationSupport {
  @MockitoSpyBean(name = "releaseAccessFacts")
  ReleaseAccessFactsProvider access;

  @MockitoSpyBean(name = "releaseParentFacts")
  ReleaseParentFactsProvider parentFacts;

  @Autowired PlatformTransactionManager transactionManager;
  @Autowired com.sourceos.identity.IdentityService identities;

  @ParameterizedTest
  @ValueSource(
      strings = {
        "sql-commit",
        "sql-rollback",
        "commit",
        "rollback",
        "autocommit",
        "read-only",
        "isolation",
        "unwrap",
        "metadata-commit",
        "statement-commit",
        "second-connection",
        "requires-new",
        "not-supported",
        "alternate-manager",
        "suspended-resource",
        "swallowed",
        "commit-failure",
        "rollback-only",
        "actor-change",
        "forged-scope"
      })
  void finalProviderBoundaryFaultReturnsZeroContent(String fault) throws Exception {
    var target = AopTestUtils.<ReleaseAccessFactsProvider>getUltimateTargetObject(access);
    var calls = new AtomicInteger();
    var failures = new AtomicInteger();
    doAnswer(
            invocation -> {
              if (calls.incrementAndGet() != 2) return invocation.callRealMethod();
              try {
                var connection = DataSourceUtils.getConnection(dataSource);
                switch (fault) {
                  case "sql-commit" -> connection.createStatement().execute("COMMIT");
                  case "sql-rollback" -> connection.createStatement().execute("ROLLBACK");
                  case "commit" -> connection.commit();
                  case "rollback" -> connection.rollback();
                  case "autocommit" -> connection.setAutoCommit(true);
                  case "read-only" -> connection.setReadOnly(false);
                  case "isolation" ->
                      connection.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
                  case "unwrap" -> connection.unwrap(Connection.class);
                  case "metadata-commit" -> connection.getMetaData().getConnection().commit();
                  case "statement-commit" -> connection.createStatement().getConnection().commit();
                  case "second-connection" -> dataSource.getConnection();
                  case "requires-new", "not-supported", "alternate-manager" -> {
                    var manager =
                        fault.equals("alternate-manager")
                            ? new DataSourceTransactionManager(dataSource)
                            : transactionManager;
                    var tx = new TransactionTemplate(manager);
                    tx.setReadOnly(true);
                    tx.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
                    tx.setPropagationBehavior(
                        fault.equals("not-supported")
                            ? TransactionDefinition.PROPAGATION_NOT_SUPPORTED
                            : TransactionDefinition.PROPAGATION_REQUIRES_NEW);
                    tx.execute(
                        status -> {
                          new ReleaseAuthorization.ScopeVerifier(identities)
                              .verifyAccess(identities.current());
                          return null;
                        });
                  }
                  case "suspended-resource" -> {
                    var resource = TransactionSynchronizationManager.unbindResource(dataSource);
                    try {
                      new ReleaseAuthorization.ScopeVerifier(identities)
                          .verifyAccess(identities.current());
                    } finally {
                      TransactionSynchronizationManager.bindResource(dataSource, resource);
                    }
                  }
                  case "swallowed" -> {
                    try {
                      connection.commit();
                    } catch (RuntimeException denied) {
                      failures.incrementAndGet();
                    }
                  }
                  case "commit-failure" ->
                      TransactionSynchronizationManager.registerSynchronization(
                          new TransactionSynchronization() {
                            @Override
                            public void beforeCommit(boolean readOnly) {
                              throw new IllegalStateException("synthetic final commit fault");
                            }
                          });
                  case "rollback-only" ->
                      TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
                  case "actor-change" -> actor(owner);
                  case "forged-scope" -> {
                    try {
                      new ReleaseAuthorization.ScopeVerifier(identities).verify(null);
                    } catch (RuntimeException denied) {
                      failures.incrementAndGet();
                    }
                  }
                  default -> throw new IllegalArgumentException(fault);
                }
              } catch (RuntimeException denied) {
                failures.incrementAndGet();
                throw denied;
              }
              return invocation.callRealMethod();
            })
        .when(target)
        .recipient(any(), any(), any());
    var response =
        mvc.perform(get(recipientPath() + "/content").header("X-Dev-Subject", foreignOwner))
            .andReturn()
            .getResponse();
    assertThat(calls).hasValue(2);
    assertThat(response.getStatus()).isBetween(400, 599);
    assertThat(response.getContentType()).doesNotStartWith("application/octet-stream");
    assertThat(
            new String(response.getContentAsByteArray(), java.nio.charset.StandardCharsets.UTF_8))
        .doesNotContain("%PDF");
    assertThat(ReleaseTransactionFence.current()).isNull();
    PatternReleaseEvidence.write(
        "F01-production-" + fault,
        Map.of(
            "providerCalls",
            calls.get(),
            "status",
            response.getStatus(),
            "contentReturned",
            false,
            "swallowedViolations",
            failures.get()));
    reset(target);
    actor(foreignOwner);
    assertThat(gateway.download(foreignOrg, releaseId()).bytes()).containsExactly(pdfBytes());
  }

  @Test
  void directProviderCannotAcquireAuthorityWithoutPrivateOwnerLease() {
    var target = AopTestUtils.<ReleaseAccessFactsProvider>getUltimateTargetObject(access);
    assertThatThrownBy(() -> target.recipient(identities.current(), foreignOrg, releaseId()))
        .isInstanceOf(RuntimeException.class);
    assertThatThrownBy(
            () ->
                new TransactionTemplate(transactionManager)
                    .execute(t -> target.recipient(identities.current(), foreignOrg, releaseId())))
        .isInstanceOf(RuntimeException.class);
  }

  @Test
  void escapedScopeViolationRemainsStickyEvenWhenAsyncFailureIsSwallowed() {
    var target = AopTestUtils.<ReleaseParentFactsProvider>getUltimateTargetObject(parentFacts);
    var attempts = new AtomicInteger();
    var rejected = new AtomicInteger();
    doAnswer(
            i -> {
              if (attempts.incrementAndGet() == 2) {
                java.util.List<ReleaseAuthorization.Scope> scopes = i.getArgument(0);
                try (var pool = java.util.concurrent.Executors.newSingleThreadExecutor()) {
                  pool.submit(
                          () -> {
                            try {
                              new ReleaseAuthorization.ScopeVerifier(identities)
                                  .verify(scopes.getFirst());
                            } catch (RuntimeException denied) {
                              rejected.incrementAndGet();
                            }
                          })
                      .get(5, java.util.concurrent.TimeUnit.SECONDS);
                }
              }
              return i.callRealMethod();
            })
        .when(target)
        .read(anyList());
    assertThatThrownBy(() -> gateway.download(foreignOrg, releaseId()))
        .isInstanceOf(RuntimeException.class);
    assertThat(attempts).hasValue(2);
    assertThat(rejected).hasValue(1);
  }

  @Test
  void readCommittedReadOnlyAndJsonDescriptorsDoNotMintOwnerAuthority() {
    var tx = new TransactionTemplate(transactionManager);
    tx.setReadOnly(true);
    tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    tx.execute(
        status -> {
          assertThat(
                  jdbc.sql("SELECT current_setting('transaction_isolation')")
                      .query(String.class)
                      .single())
              .isEqualTo("read committed");
          assertThatThrownBy(
                  () ->
                      AopTestUtils.<ReleaseAccessFactsProvider>getUltimateTargetObject(access)
                          .recipient(identities.current(), foreignOrg, releaseId()))
              .isInstanceOf(RuntimeException.class);
          return null;
        });
    for (var type :
        java.util.List.of(ReleaseAuthorization.Scope.class, ReleaseAuthorization.Binding.class))
      assertThatThrownBy(() -> json.readValue("{}", type)).isInstanceOf(Exception.class);
  }
}
