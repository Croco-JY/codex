package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class GradingMigrationTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  Map<String, List<String>> snapshot(Connection c) throws Exception {
    var result = new TreeMap<String, List<String>>();
    var names = new ArrayList<String>();
    try (var q = c.createStatement();
        var r =
            q.executeQuery(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND"
                    + " table_type='BASE TABLE' AND table_name<>'flyway_schema_history' ORDER"
                    + " BY 1")) {
      while (r.next()) names.add(r.getString(1));
    }
    for (String name : names) {
      var rows = new ArrayList<String>();
      try (var q = c.createStatement();
          var r = q.executeQuery("SELECT row_to_json(t)::text FROM " + name + " t ORDER BY 1")) {
        while (r.next()) rows.add(r.getString(1));
      }
      result.put(name, rows);
    }
    return result;
  }

  List<String> triggers(Connection c) throws Exception {
    var result = new ArrayList<String>();
    try (var q = c.createStatement();
        var r =
            q.executeQuery(
                "SELECT pg_get_triggerdef(oid)||':'||tgenabled::text FROM pg_trigger WHERE NOT"
                    + " tgisinternal ORDER BY tgname")) {
      while (r.next()) result.add(r.getString(1));
    }
    return result;
  }

  @Test
  void populatedV20ToV21PreservesEveryBusinessRowAndHistoricalGuard() throws Exception {
    var old =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("20")
            .load();
    old.migrate();
    old.validate();
    assertThat(old.info().applied()).hasSize(20);
    Map<String, List<String>> before;
    List<String> beforeTriggers;
    UUID org = UUID.randomUUID(),
        project = UUID.randomUUID(),
        style = UUID.randomUUID(),
        ms = UUID.randomUUID(),
        mr = UUID.randomUUID(),
        pattern = UUID.randomUUID();
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      q.execute(
          "INSERT INTO organization(id,name) VALUES('" + org + "','Synthetic populated V20')");
      q.execute(
          "INSERT INTO membership(id,organization_id,issuer,subject,role)"
              + " VALUES(gen_random_uuid(),'"
              + org
              + "','urn:synthetic','owner','ORG_OWNER')");
      q.execute(
          "INSERT INTO project(id,organization_id,name) VALUES('"
              + project
              + "','"
              + org
              + "','Project')");
      q.execute(
          "INSERT INTO style(id,project_id,name) VALUES('"
              + style
              + "','"
              + project
              + "','Style')");
      c.setAutoCommit(false);
      q.execute("INSERT INTO measurement_spec(id,style_id) VALUES('" + ms + "','" + style + "')");
      q.execute(
          "INSERT INTO"
              + " measurement_revision(id,measurement_spec_id,style_id,revision_number,base_size,unit_system,created_by_issuer,created_by_subject)"
              + " VALUES('"
              + mr
              + "','"
              + ms
              + "','"
              + style
              + "',1,'M','CM','urn:synthetic','owner')");
      q.execute(
          "INSERT INTO measurement_point(measurement_revision_id,position,code,label,value)"
              + " VALUES('"
              + mr
              + "',0,'CHEST','Chest',999999999999999.9999)");
      q.execute("UPDATE measurement_revision SET sealed=true WHERE id='" + mr + "'");
      q.execute("INSERT INTO pattern(id,style_id) VALUES('" + pattern + "','" + style + "')");
      for (int i = 1; i <= 3; i++) {
        UUID revision = UUID.randomUUID(), artifact = UUID.randomUUID();
        q.execute(
            "INSERT INTO"
                + " pattern_revision(id,pattern_id,style_id,revision_number,name,measurement_revision_id,created_by_issuer,created_by_subject,artifact_expected)"
                + " VALUES('"
                + revision
                + "','"
                + pattern
                + "','"
                + style
                + "',"
                + i
                + ",'Pattern snapshot','"
                + mr
                + "','urn:synthetic','owner',true)");
        q.execute(
            "INSERT INTO"
                + " pattern_artifact(id,pattern_revision_id,style_id,storage_object_id,declared_format,display_name,size_bytes,sha256,state)"
                + " VALUES('"
                + artifact
                + "','"
                + revision
                + "','"
                + style
                + "',gen_random_uuid(),'PDF','Private.pdf',10,repeat('a',64),'PENDING')");
        if (i > 1)
          q.execute(
              "UPDATE pattern_artifact SET state='"
                  + (i == 2 ? "READY" : "FAILED")
                  + "',failure_code="
                  + (i == 2 ? "null" : "'STORAGE_WRITE_FAILED'")
                  + ",version=1,updated_at=clock_timestamp()+interval '1 microsecond' WHERE id='"
                  + artifact
                  + "'");
      }
      c.commit();
      before = snapshot(c);
      beforeTriggers = triggers(c);
      assertThat(before).hasSize(52);
      assertThat(before.get("pattern_artifact")).hasSize(3);
    }
    var latest =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("21")
            .load();
    latest.migrate();
    latest.validate();
    assertThat(latest.info().applied()).hasSize(21);
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword())) {
      var after = snapshot(c);
      assertThat(after).hasSize(57);
      before.forEach((table, rows) -> assertThat(after.get(table)).as(table).isEqualTo(rows));
      assertThat(triggers(c)).containsAll(beforeTriggers);
      for (String table :
          List.of(
              "grade_rule_set",
              "grade_rule_set_revision",
              "grade_size",
              "grade_rule",
              "grade_rule_value")) assertThat(after.get(table)).as(table).isEmpty();
      try (var q = c.createStatement();
          var r = q.executeQuery("SELECT state FROM pattern_artifact ORDER BY state")) {
        var states = new ArrayList<String>();
        while (r.next()) states.add(r.getString(1));
        assertThat(states).containsExactly("FAILED", "PENDING", "READY");
      }
    }
  }
}
