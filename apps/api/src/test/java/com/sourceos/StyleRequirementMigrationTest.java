package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class StyleRequirementMigrationTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  @Test
  void populatedV13UpgradePreservesAllRowsAndAddsOnlyEmptyRequirement() throws Exception {
    var source =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("13")
            .load();
    source.migrate();
    Map<String, List<String>> before;
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      q.execute(
          "INSERT INTO organization(id,name)"
              + " VALUES('11111111-1111-4111-8111-111111111111','Synthetic V13 Organization')");
      q.execute(
          "INSERT INTO membership(id,organization_id,issuer,subject,role)"
              + " VALUES(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','urn:synthetic','owner','ORG_OWNER')");
      q.execute(
          "INSERT INTO project(id,organization_id,name,version)"
              + " VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Synthetic"
              + " existing Project',7)");
      q.execute(
          "INSERT INTO style(id,project_id,name,style_code,status,version)"
              + " VALUES('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Synthetic"
              + " existing Style','Case-Keep','ARCHIVED',3)");
      q.execute(
          "INSERT INTO"
              + " audit_event(id,actor_issuer,actor_subject,organization_id,scope,entity_type,entity_id,action,request_id)"
              + " VALUES(gen_random_uuid(),'urn:synthetic','owner','11111111-1111-4111-8111-111111111111','ORGANIZATION','Style','33333333-3333-4333-8333-333333333333','style.archived','synthetic-upgrade')");
      before = snapshot(c);
      assertThat(before).hasSize(42);
    }
    var upgraded =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("14")
            .load();
    upgraded.migrate();
    upgraded.validate();
    assertThat(upgraded.info().applied()).hasSize(14);
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      var after = snapshot(c);
      assertThat(after).hasSize(43);
      var tables = new HashSet<>(before.keySet());
      tables.add("style_requirement");
      assertThat(after.keySet()).containsExactlyInAnyOrderElementsOf(tables);
      before.forEach((name, rows) -> assertThat(after.get(name)).as(name).isEqualTo(rows));
      assertThat(after.get("style_requirement")).isEmpty();
      q.execute(
          "INSERT INTO"
              + " style_requirement(style_id,target_quantity,quantity_unit,target_cost,currency,target_delivery_date)"
              + " VALUES('33333333-3333-4333-8333-333333333333',0,'PCS',999999999999999.9999,'USD','1990-01-01')");
      var r = q.executeQuery("SELECT target_quantity,target_cost FROM style_requirement");
      assertThat(r.next()).isTrue();
      assertThat(r.getBigDecimal(1)).isEqualByComparingTo("0");
      assertThat(r.getBigDecimal(2)).isEqualByComparingTo("999999999999999.9999");
    }
  }

  private Map<String, List<String>> snapshot(Connection c) throws SQLException {
    var names = new ArrayList<String>();
    try (var q = c.createStatement();
        var r =
            q.executeQuery(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND"
                    + " table_type='BASE TABLE' AND table_name<>'flyway_schema_history' ORDER BY"
                    + " table_name")) {
      while (r.next()) names.add(r.getString(1));
    }
    var all = new LinkedHashMap<String, List<String>>();
    for (String name : names) {
      var rows = new ArrayList<String>();
      try (var q = c.createStatement();
          var r = q.executeQuery("SELECT row_to_json(t)::text FROM " + name + " t ORDER BY 1")) {
        while (r.next()) rows.add(r.getString(1));
      }
      all.put(name, rows);
    }
    return all;
  }
}
