package com.sourceos.authorization;

import java.io.PrintWriter;
import java.lang.reflect.*;
import java.sql.*;
import java.util.*;
import java.util.logging.Logger;
import javax.sql.DataSource;

/** Standard JDBC wrappers mediate only a privately activated release facts lease. */
final class ReleaseDataSource implements DataSource, AutoCloseable {
  private final DataSource delegate;

  ReleaseDataSource(DataSource delegate) {
    this.delegate = delegate;
  }

  String poolType() {
    return delegate.getClass().getName();
  }

  @Override
  public Connection getConnection() throws SQLException {
    ReleaseTransactionFence.beforeBorrow();
    return connection(delegate.getConnection());
  }

  @Override
  public Connection getConnection(String user, String password) throws SQLException {
    ReleaseTransactionFence.beforeBorrow();
    return connection(delegate.getConnection(user, password));
  }

  private Connection connection(Connection raw) {
    final Connection[] self = new Connection[1];
    self[0] =
        (Connection)
            Proxy.newProxyInstance(
                Connection.class.getClassLoader(),
                new Class<?>[] {Connection.class},
                (proxy, m, args) -> {
                  if (m.getName().equals("equals")) return proxy == args[0];
                  if (m.getName().equals("hashCode")) return System.identityHashCode(proxy);
                  if (m.getName().equals("toString")) return "ReleaseGuardedConnection";
                  ReleaseTransactionFence.beforeConnection(self[0], m.getName());
                  String sql =
                      args != null
                              && args.length > 0
                              && args[0] instanceof String s
                              && m.getName().startsWith("prepare")
                          ? s
                          : null;
                  if (sql != null) ReleaseTransactionFence.beforeSql(sql);
                  Object value = invoke(raw, m, args);
                  if (value instanceof Statement st) return statement(st, self[0], sql);
                  if (value instanceof DatabaseMetaData md)
                    return Proxy.newProxyInstance(
                        DatabaseMetaData.class.getClassLoader(),
                        new Class<?>[] {DatabaseMetaData.class},
                        (p, mm, aa) -> {
                          ReleaseTransactionFence.beforeStatement(self[0]);
                          if (mm.getName().equals("getConnection")) return self[0];
                          denyUnwrap(mm.getName());
                          Object v = invoke(md, mm, aa);
                          return v instanceof ResultSet rs ? result(rs, self[0], null) : v;
                        });
                  return value;
                });
    return self[0];
  }

  private Object statement(Statement raw, Connection connection, String preparedSql) {
    Class<?> type =
        raw instanceof CallableStatement
            ? CallableStatement.class
            : raw instanceof PreparedStatement ? PreparedStatement.class : Statement.class;
    final Object[] self = new Object[1];
    var batch = new ArrayList<String>();
    self[0] =
        Proxy.newProxyInstance(
            Statement.class.getClassLoader(),
            new Class<?>[] {type},
            (proxy, m, args) -> {
              ReleaseTransactionFence.beforeStatement(connection);
              if (m.getName().equals("getConnection")) return connection;
              denyUnwrap(m.getName());
              String sql =
                  args != null && args.length > 0 && args[0] instanceof String s ? s : null;
              if (sql != null
                  && (m.getName().startsWith("execute") || m.getName().equals("addBatch")))
                ReleaseTransactionFence.beforeSql(sql);
              if (m.getName().equals("addBatch") && sql != null) batch.add(sql);
              if (m.getName().equals("clearBatch")) batch.clear();
              if (m.getName().startsWith("execute")) {
                if (preparedSql != null) ReleaseTransactionFence.beforeSql(preparedSql);
                if (m.getName().contains("Batch"))
                  for (String command : batch) ReleaseTransactionFence.beforeSql(command);
              }
              Object value = invoke(raw, m, args);
              return value instanceof ResultSet rs ? result(rs, connection, self[0]) : value;
            });
    return self[0];
  }

  private Object result(ResultSet raw, Connection connection, Object statement) {
    return Proxy.newProxyInstance(
        ResultSet.class.getClassLoader(),
        new Class<?>[] {ResultSet.class},
        (p, m, args) -> {
          ReleaseTransactionFence.beforeStatement(connection);
          denyUnwrap(m.getName());
          if (m.getName().equals("getStatement")) {
            if (statement != null) return statement;
            var original = raw.getStatement();
            return original == null ? null : statement(original, connection, null);
          }
          return invoke(raw, m, args);
        });
  }

  private static void denyUnwrap(String operation) {
    if (operation.equals("unwrap")
        && ReleaseTransactionFence.current() != null
        && ReleaseTransactionFence.current().phase == ReleaseTransactionFence.Phase.FACTS)
      ReleaseTransactionFence.current().reject("Raw JDBC unwrap");
  }

  private static Object invoke(Object target, Method method, Object[] args) throws Throwable {
    try {
      return method.invoke(target, args);
    } catch (InvocationTargetException e) {
      var cause = e.getCause();
      var lease = ReleaseTransactionFence.current();
      if (cause instanceof SQLException
          && lease != null
          && lease.phase == ReleaseTransactionFence.Phase.FACTS) lease.reject("Facts JDBC failure");
      throw cause;
    }
  }

  @Override
  public <T> T unwrap(Class<T> type) throws SQLException {
    denyUnwrap("unwrap");
    return delegate.unwrap(type);
  }

  @Override
  public boolean isWrapperFor(Class<?> type) throws SQLException {
    return delegate.isWrapperFor(type);
  }

  @Override
  public PrintWriter getLogWriter() throws SQLException {
    return delegate.getLogWriter();
  }

  @Override
  public void setLogWriter(PrintWriter writer) throws SQLException {
    delegate.setLogWriter(writer);
  }

  @Override
  public void setLoginTimeout(int seconds) throws SQLException {
    delegate.setLoginTimeout(seconds);
  }

  @Override
  public int getLoginTimeout() throws SQLException {
    return delegate.getLoginTimeout();
  }

  @Override
  public Logger getParentLogger() throws SQLFeatureNotSupportedException {
    return delegate.getParentLogger();
  }

  @Override
  public void close() throws Exception {
    if (delegate instanceof AutoCloseable c) c.close();
  }
}
