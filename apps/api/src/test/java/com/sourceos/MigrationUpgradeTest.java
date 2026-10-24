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
      assertNamedRecordKindConstraint(c);
    }
  }

  @Test
  void cleanMigrationsHaveOnlyExpectedTablesAndNoAdministratorSeed() throws Exception {
    String name = "fresh_" + UUID.randomUUID().toString().replace("-", "");
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var statement = c.createStatement()) {
      statement.execute("CREATE DATABASE " + name);
    }
    String url = "jdbc:postgresql://" + db.getHost() + ":" + db.getMappedPort(5432) + "/" + name;
    var migration = Flyway.configure().dataSource(url, db.getUsername(), db.getPassword()).load();
    migration.migrate();
    migration.validate();
    assertThat(migration.info().applied()).hasSize(18);
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
      assertThat(tables.getInt(1)).isEqualTo(50);
      var json =
          statement.executeQuery(
              "SELECT count(*) FROM information_schema.columns WHERE table_name IN"
                  + " ('data_source_record','data_source_observation','data_source_observation_review')"
                  + " AND data_type='jsonb'");
      json.next();
      assertThat(json.getInt(1)).isZero();
      var newTables =
          List.of(
              "material",
              "material_external_record",
              "material_source",
              "material_variant",
              "material_variant_external_record",
              "material_variant_source",
              "fabric_spec",
              "leather_spec",
              "fiber_type",
              "material_composition",
              "supplier_material_listing",
              "supplier_material_listing_external_record",
              "supplier_material_listing_source",
              "material_price",
              "material_price_source",
              "material_inventory_snapshot",
              "project",
              "style",
              "style_requirement",
              "style_material_selection",
              "style_facility_candidate",
              "style_development_reference",
              "measurement_spec", "measurement_revision", "measurement_point");
      for (String table : newTables) {
        var rows = statement.executeQuery("SELECT count(*) FROM " + table);
        rows.next();
        assertThat(rows.getLong(1)).as(table).isEqualTo(table.equals("fiber_type") ? 13 : 0);
      }
      assertNamedRecordKindConstraint(c);
    }
  }

  private void assertNamedRecordKindConstraint(Connection connection) throws SQLException {
    try (var statement = connection.createStatement()) {
      var constraint =
          statement.executeQuery(
              """
              SELECT count(*) FROM pg_constraint
              WHERE conrelid='data_source_record'::regclass
                AND conname='data_source_record_kind_check' AND contype='c' AND convalidated
              """);
      assertThat(constraint.next()).isTrue();
      assertThat(constraint.getInt(1)).isEqualTo(1);
    }
    UUID source = UUID.randomUUID();
    try (var insert =
        connection.prepareStatement(
            """
            INSERT INTO data_source(id,source_code,source_type,name,access_method)
            VALUES(?,?,'MANUAL_ENTRY','Synthetic record kind constraint test','MANUAL')
            """)) {
      insert.setObject(1, source);
      insert.setString(2, "kind-check-" + source);
      assertThat(insert.executeUpdate()).isEqualTo(1);
    }
    try (var insert =
        connection.prepareStatement(
            """
            INSERT INTO data_source_record
              (id,data_source_id,record_kind,external_record_key,normalized_external_record_key)
            VALUES(?,?,?,'same-external-key','same-external-key')
            """)) {
      insert.setObject(2, source);
      for (String kind : List.of("SUPPLIER", "FACILITY", "MATERIAL", "MATERIAL_VARIANT")) {
        insert.setObject(1, UUID.randomUUID());
        insert.setString(3, kind);
        assertThat(insert.executeUpdate()).isEqualTo(1);
      }
      insert.setObject(1, UUID.randomUUID());
      insert.setString(3, "INVALID_KIND");
      assertThatThrownBy(insert::executeUpdate)
          .isInstanceOfSatisfying(
              org.postgresql.util.PSQLException.class,
              error -> {
                assertThat(error.getSQLState()).isEqualTo("23514");
                assertThat(error.getServerErrorMessage().getConstraint())
                    .isEqualTo("data_source_record_kind_check");
              });
    }
  }
}
