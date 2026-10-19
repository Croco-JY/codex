package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class MigrationUpgradeTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  @Test
  void populatedPhaseZeroUpgradesWithoutChangingAuditOrGuards() throws Exception {
    Flyway.configure()
        .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
        .target("2")
        .load()
        .migrate();
    UUID org = UUID.randomUUID(), event = UUID.randomUUID();
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var stmt = c.createStatement()) {
      stmt.execute("INSERT INTO organization(id,name) VALUES('" + org + "','Legacy')");
      stmt.execute(
          "INSERT INTO membership(id,organization_id,issuer,subject,role)"
              + " VALUES(gen_random_uuid(),'"
              + org
              + "','legacy-issuer','legacy-user','ORG_OWNER')");
      stmt.execute(
          "INSERT INTO audit_event(id,actor_issuer,actor_subject,organization_id,action,request_id)"
              + " VALUES('"
              + event
              + "','legacy-issuer','legacy-user','"
              + org
              + "','legacy.created','legacy-request')");
    }
    var flyway =
        Flyway.configure().dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword()).load();
    flyway.migrate();
    flyway.validate();
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var stmt = c.createStatement()) {
      var rs =
          stmt.executeQuery(
              "SELECT scope,organization_id,actor_subject,request_id,entity_id FROM audit_event"
                  + " WHERE id='"
                  + event
                  + "'");
      assertThat(rs.next()).isTrue();
      assertThat(rs.getString(1)).isEqualTo("ORGANIZATION");
      assertThat(rs.getObject(2)).isEqualTo(org);
      assertThat(rs.getString(3)).isEqualTo("legacy-user");
      assertThat(rs.getString(4)).isEqualTo("legacy-request");
      assertThat(rs.getObject(5)).isNull();
      for (String sql :
          List.of(
              "UPDATE audit_event SET action='bad'",
              "DELETE FROM audit_event",
              "TRUNCATE audit_event"))
        assertThatThrownBy(() -> stmt.execute(sql))
            .isInstanceOf(SQLException.class)
            .hasMessageContaining("append-only");
    }
  }

  @Test
  void cleanV1ToV8HasOnlyExpectedTablesAndNoAdministratorSeed() throws Exception {
    String name = "fresh_" + UUID.randomUUID().toString().replace("-", "");
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var statement = c.createStatement()) {
      statement.execute("CREATE DATABASE " + name);
    }
    String url = "jdbc:postgresql://" + db.getHost() + ":" + db.getMappedPort(5432) + "/" + name;
    var migration = Flyway.configure().dataSource(url, db.getUsername(), db.getPassword()).load();
    migration.migrate();
    migration.validate();
    assertThat(migration.info().applied()).hasSize(8);
    try (var c = DriverManager.getConnection(url, db.getUsername(), db.getPassword());
        var statement = c.createStatement()) {
      var count = statement.executeQuery("SELECT count(*) FROM platform_role_assignment");
      count.next();
      assertThat(count.getInt(1)).isZero();
      var tables =
          statement.executeQuery(
              "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND"
                  + " table_type='BASE TABLE'");
      tables.next();
      assertThat(tables.getInt(1)).isEqualTo(25);
      var json =
          statement.executeQuery(
              "SELECT count(*) FROM information_schema.columns WHERE table_name IN"
                  + " ('data_source_record','data_source_observation','data_source_observation_review')"
                  + " AND data_type='jsonb'");
      json.next();
      assertThat(json.getInt(1)).isZero();
    }
  }
}
