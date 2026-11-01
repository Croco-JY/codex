package com.sourceos.authorization;

import java.sql.Connection;
import java.util.*;
import javax.sql.DataSource;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Private physical-resource ownership. No catalog polling or public activation API. */
final class ReleaseTransactionFence {
  private static final ThreadLocal<Lease> CURRENT = new ThreadLocal<>();

  enum Phase {
    FACTS,
    COMPLETING
  }

  static final class Lease {
    final DataSource source;
    final Connection connection;
    final Object resource;
    final Thread thread = Thread.currentThread();
    final TransactionStatus status;
    Phase phase = Phase.FACTS;
    private final java.util.concurrent.atomic.AtomicReference<String> denied =
        new java.util.concurrent.atomic.AtomicReference<>();

    private Lease(DataSource ds, Connection c, Object resource, TransactionStatus status) {
      source = ds;
      connection = c;
      this.resource = resource;
      this.status = status;
    }

    void reject(String reason) {
      poison(reason);
      throw ReleaseAuthorization.unavailable();
    }

    void poison(String reason) {
      denied.compareAndSet(null, reason);
      if (Thread.currentThread() == thread && !status.isCompleted()) status.setRollbackOnly();
    }

    void healthy() {
      if (denied.get() != null) {
        poison(denied.get());
        throw ReleaseAuthorization.unavailable();
      }
    }
  }

  static Lease current() {
    return CURRENT.get();
  }

  static Lease enter(DataSource source, TransactionStatus status) {
    if (current() != null) current().reject("Nested release owner");
    if (!status.isNewTransaction()
        || !TransactionSynchronizationManager.isActualTransactionActive()
        || !TransactionSynchronizationManager.isCurrentTransactionReadOnly()
        || !Objects.equals(
            TransactionSynchronizationManager.getCurrentTransactionIsolationLevel(),
            Connection.TRANSACTION_REPEATABLE_READ)) throw ReleaseAuthorization.unavailable();
    var connection = DataSourceUtils.getConnection(source);
    try {
      if (connection.getAutoCommit()
          || !connection.isReadOnly()
          || connection.getTransactionIsolation() != Connection.TRANSACTION_REPEATABLE_READ)
        throw ReleaseAuthorization.unavailable();
    } catch (java.sql.SQLException e) {
      throw ReleaseAuthorization.unavailable();
    }
    var lease =
        new Lease(
            source, connection, TransactionSynchronizationManager.getResource(source), status);
    CURRENT.set(lease);
    return lease;
  }

  static Lease require() {
    var l = current();
    if (l == null) throw ReleaseAuthorization.unavailable();
    verify(l);
    return l;
  }

  static void verify(Lease l) {
    if (current() != l || l.thread != Thread.currentThread()) l.reject("Thread or lease changed");
    l.healthy();
    if (l.phase != Phase.FACTS
        || !TransactionSynchronizationManager.isActualTransactionActive()
        || !TransactionSynchronizationManager.isCurrentTransactionReadOnly()
        || !Objects.equals(
            TransactionSynchronizationManager.getCurrentTransactionIsolationLevel(),
            Connection.TRANSACTION_REPEATABLE_READ)
        || TransactionSynchronizationManager.getResource(l.source) != l.resource
        || DataSourceUtils.getConnection(l.source) != l.connection)
      l.reject("Transaction resource changed");
  }

  static void beforeBorrow() {
    var l = current();
    if (l != null && l.phase == Phase.FACTS) l.reject("Additional connection");
  }

  static void beforeConnection(Connection connection, String operation) {
    var l = current();
    if (l == null || l.phase == Phase.COMPLETING) return;
    verify(l);
    if (connection != l.connection) l.reject("Different physical resource");
    if (Set.of(
            "commit",
            "rollback",
            "setAutoCommit",
            "setTransactionIsolation",
            "setReadOnly",
            "setSavepoint",
            "releaseSavepoint",
            "abort",
            "close",
            "unwrap",
            "setSchema",
            "setCatalog",
            "beginRequest",
            "endRequest")
        .contains(operation)) l.reject("Forbidden connection boundary");
  }

  static void beforeStatement(Connection connection) {
    var l = current();
    if (l == null || l.phase == Phase.COMPLETING) return;
    verify(l);
    if (connection != l.connection) l.reject("Statement outside owner connection");
  }

  static void beforeSql(String sql) {
    var l = current();
    if (l == null || l.phase == Phase.COMPLETING) return;
    verify(l);
    String value = sql.stripLeading().toLowerCase(Locale.ROOT);
    if (!value.matches("(?s)^select\\b.*")
        || value.contains(";")
        || value.contains("--")
        || value.contains("/*")
        || value.matches("(?s).*\\bset_config\\s*\\(.*")) l.reject("Unsupported facts SQL");
  }

  static void completing(Lease lease) {
    if (current() != lease) throw ReleaseAuthorization.unavailable();
    lease.phase = Phase.COMPLETING;
  }

  static void clear(Lease lease) {
    if (current() == lease) CURRENT.remove();
  }
}
