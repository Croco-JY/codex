package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class PatternMigrationTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  @Test
  void populatedV18ToV19PreservesAllEarlierTruth() throws Exception {
    var f =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("18")
            .load();
    f.migrate();
    Map<String, List<String>> before;
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      q.execute(
          "INSERT INTO organization(id,name)"
              + " VALUES('11111111-1111-4111-8111-111111111111','Synthetic upgrade')");
      q.execute(
          "INSERT INTO membership(id,organization_id,issuer,subject,role)"
              + " VALUES(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','urn:synthetic','owner','ORG_OWNER')");
      q.execute(
          "INSERT INTO project(id,organization_id,name)"
              + " VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Project')");
      q.execute(
          "INSERT INTO style(id,project_id,name)"
              + " VALUES('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Style')");
      c.setAutoCommit(false);
      q.execute(
          "INSERT INTO measurement_spec(id,style_id)"
              + " VALUES('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333')");
      q.execute(
          "INSERT INTO"
              + " measurement_revision(id,measurement_spec_id,style_id,revision_number,base_size,unit_system,created_by_issuer,created_by_subject)"
              + " VALUES('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333',1,'M','CM','urn:synthetic','owner')");
      q.execute(
          "INSERT INTO"
              + " measurement_point(measurement_revision_id,position,code,label,value,tolerance_plus)"
              + " VALUES('55555555-5555-4555-8555-555555555555',0,'CHEST','Chest',999999999999999.9999,0.0001)");
      q.execute("UPDATE measurement_revision SET sealed=true");
      c.commit();
      before = snapshot(c);
      assertThat(before).hasSize(49);
    }
    var latest =
        Flyway.configure().dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword()).load();
    latest.migrate();
    latest.validate();
    assertThat(latest.info().applied()).hasSize(19);
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword())) {
      var after = snapshot(c);
      assertThat(after).hasSize(51);
      before.forEach((t, rows) -> assertThat(after.get(t)).as(t).isEqualTo(rows));
      assertThat(after.get("pattern")).isEmpty();
      assertThat(after.get("pattern_revision")).isEmpty();
    }
  }

  @Test
  void freshV19Inventory() throws Exception {
    String name = "pattern_fresh_" + UUID.randomUUID().toString().replace("-", "");
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      q.execute("CREATE DATABASE " + name);
    }
    String url = "jdbc:postgresql://" + db.getHost() + ":" + db.getMappedPort(5432) + "/" + name;
    var f = Flyway.configure().dataSource(url, db.getUsername(), db.getPassword()).load();
    f.migrate();
    f.validate();
    assertThat(f.info().applied()).hasSize(19);
    try (var c = DriverManager.getConnection(url, db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      assertThat(snapshot(c)).hasSize(51);
      var r =
          q.executeQuery(
              "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND"
                  + " table_type='BASE TABLE'");
      r.next();
      assertThat(r.getInt(1)).isEqualTo(52);
    }
  }

  Map<String, List<String>> snapshot(Connection c) throws SQLException {
    var names = new ArrayList<String>();
    try (var q = c.createStatement();
        var r =
            q.executeQuery(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND"
                    + " table_type='BASE TABLE' AND table_name<>'flyway_schema_history' ORDER BY"
                    + " table_name")) {
      while (r.next()) names.add(r.getString(1));
    }
    var out = new LinkedHashMap<String, List<String>>();
    for (String t : names) {
      var rows = new ArrayList<String>();
      try (var q = c.createStatement();
          var r = q.executeQuery("SELECT row_to_json(t)::text FROM " + t + " t ORDER BY 1")) {
        while (r.next()) rows.add(r.getString(1));
      }
      out.put(t, rows);
    }
    return out;
  }
}
