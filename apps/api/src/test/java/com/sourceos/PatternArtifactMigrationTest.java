package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class PatternArtifactMigrationTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  Map<String, List<String>> snapshot(Connection c, boolean upgraded) throws SQLException {
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
    for (String name : names) {
      var rows = new ArrayList<String>();
      try (var q = c.createStatement();
          var r =
              q.executeQuery(
                  "SELECT (to_jsonb(t)"
                      + (upgraded && name.equals("pattern_revision") ? "-'artifact_expected'" : "")
                      + ")::text FROM "
                      + name
                      + " t ORDER BY 1")) {
        while (r.next()) rows.add(r.getString(1));
      }
      out.put(name, rows);
    }
    return out;
  }

  @Test
  void populatedV19UpgradePreservesRowsAndUnmodifiedV19Trigger() throws Exception {
    var f =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("19")
            .load();
    f.migrate();
    Map<String, List<String>> before;
    String trigger;
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      q.execute(
          "INSERT INTO organization(id,name)"
              + " VALUES('11111111-1111-4111-8111-111111111111','Synthetic V19')");
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
          "INSERT INTO measurement_point(measurement_revision_id,position,code,label,value)"
              + " VALUES('55555555-5555-4555-8555-555555555555',0,'CHEST','Chest',999999999999999.9999)");
      q.execute("UPDATE measurement_revision SET sealed=true");
      for (int i = 1; i <= 2; i++) {
        String p = "66666666-6666-4666-8666-66666666666" + i;
        q.execute(
            "INSERT INTO pattern(id,style_id) VALUES('"
                + p
                + "','33333333-3333-4333-8333-333333333333')");
        q.execute(
            "INSERT INTO"
                + " pattern_revision(id,pattern_id,style_id,revision_number,name,measurement_revision_id,created_by_issuer,created_by_subject)"
                + " VALUES(gen_random_uuid(),'"
                + p
                + "','33333333-3333-4333-8333-333333333333',1,'Metadata-only',"
                + (i == 1 ? "null" : "'55555555-5555-4555-8555-555555555555'")
                + ",'urn:synthetic','owner')");
        if (i == 2)
          q.execute(
              "UPDATE pattern SET status='ARCHIVED',version=1,updated_at=clock_timestamp()+interval"
                  + " '1 second' WHERE id='"
                  + p
                  + "'");
      }
      c.commit();
      before = snapshot(c, false);
      assertThat(before).hasSize(51);
      var r =
          q.executeQuery(
              "SELECT pg_get_triggerdef(oid)||':'||tgenabled::text FROM pg_trigger WHERE"
                  + " tgname='pattern_revision_no_update'");
      r.next();
      trigger = r.getString(1);
    }
    var latest =
        Flyway.configure().dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword()).load();
    latest.migrate();
    latest.validate();
    assertThat(latest.info().applied()).hasSize(20);
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      var after = snapshot(c, true);
      assertThat(after).hasSize(52);
      before.forEach((t, rows) -> assertThat(after.get(t)).as(t).isEqualTo(rows));
      assertThat(after.get("pattern_artifact")).isEmpty();
      var r = q.executeQuery("SELECT count(*) FROM pattern_revision WHERE artifact_expected");
      r.next();
      assertThat(r.getInt(1)).isZero();
      r =
          q.executeQuery(
              "SELECT pg_get_triggerdef(oid)||':'||tgenabled::text FROM pg_trigger WHERE"
                  + " tgname='pattern_revision_no_update'");
      r.next();
      assertThat(r.getString(1)).isEqualTo(trigger).endsWith(":O");
      assertThatThrownBy(() -> q.execute("UPDATE pattern_revision SET artifact_expected=true"))
          .isInstanceOf(SQLException.class);
    }
  }

  @Test
  void freshV20Inventory() throws Exception {
    String name = "artifact_fresh_" + UUID.randomUUID().toString().replace("-", "");
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      q.execute("CREATE DATABASE " + name);
    }
    String url = "jdbc:postgresql://" + db.getHost() + ":" + db.getMappedPort(5432) + "/" + name;
    var f = Flyway.configure().dataSource(url, db.getUsername(), db.getPassword()).load();
    f.migrate();
    f.validate();
    assertThat(f.info().applied()).hasSize(20);
    try (var c = DriverManager.getConnection(url, db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      assertThat(snapshot(c, true)).hasSize(52);
      var r =
          q.executeQuery(
              "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND"
                  + " table_type='BASE TABLE'");
      r.next();
      assertThat(r.getInt(1)).isEqualTo(53);
    }
  }
}
