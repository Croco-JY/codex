package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class WorkspaceMigrationTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  @Test
  void populatedV12UpgradePreservesEveryLegacyRowAndAddsOnlyEmptyWorkspaceTables()
      throws Exception {
    Flyway.configure()
        .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
        .target("12")
        .load()
        .migrate();
    Map<String, List<String>> before;
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      q.execute(
          "INSERT INTO organization(id,name)"
              + " VALUES('11111111-1111-4111-8111-111111111111','Synthetic V12 Organization')");
      q.execute(
          "INSERT INTO membership(id,organization_id,issuer,subject,role)"
              + " VALUES(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','urn:legacy','legacy-owner','ORG_OWNER')");
      q.execute(
          "INSERT INTO audit_event(id,actor_issuer,actor_subject,organization_id,action,request_id)"
              + " VALUES(gen_random_uuid(),'urn:legacy','legacy-owner','11111111-1111-4111-8111-111111111111','legacy.created','legacy-upgrade')");
      q.execute(
          "INSERT INTO data_source(id,source_code,source_type,name,access_method)"
              + " VALUES('22222222-2222-4222-8222-222222222222','legacy-source','MANUAL_ENTRY','Synthetic"
              + " V12 Source','MANUAL')");
      q.execute(
          "INSERT INTO"
              + " data_source_record(id,data_source_id,record_kind,external_record_key,normalized_external_record_key)"
              + " VALUES('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','MATERIAL_LISTING','legacy-record','legacy-record')");
      q.execute(
          "INSERT INTO data_source_observation(id,source_record_id,observation_key,observed_at)"
              + " VALUES('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','legacy-observation',now())");
      q.execute(
          "INSERT INTO supplier_profile(id,country_id,display_name,normalized_name)"
              + " VALUES('55555555-5555-4555-8555-555555555555','00000000-0000-4000-8000-000000000002','Synthetic"
              + " V12 Supplier','synthetic v12 supplier')");
      q.execute(
          "INSERT INTO"
              + " material(id,catalog_supplier_id,material_type,display_name,normalized_name,status)"
              + " VALUES('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555','FABRIC','Synthetic"
              + " V12 Material','synthetic v12 material','ACTIVE')");
      q.execute(
          "INSERT INTO supplier_material_listing(id,material_id,seller_supplier_id)"
              + " VALUES('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555')");
      q.execute(
          "INSERT INTO"
              + " material_price(id,listing_id,material_id,data_source_id,amount,currency,price_unit,valid_from,observed_at)"
              + " VALUES('88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222',999999999999999.9999,'JPY','METER',now(),now())");
      q.execute(
          "INSERT INTO material_price_source(material_price_id,source_observation_id)"
              + " VALUES('88888888-8888-4888-8888-888888888888','44444444-4444-4444-8444-444444444444')");
      q.execute(
          "INSERT INTO"
              + " material_inventory_snapshot(id,listing_id,material_id,quantity,unit,capture_mode,observed_at,manual_idempotency_key,actor_issuer,actor_subject)"
              + " VALUES(gen_random_uuid(),'77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666',0,'METER','MANUAL',now(),'legacy-key','urn:legacy','legacy-owner')");
      before = snapshot(c);
      assertThat(before).hasSize(40); // 41 base tables includes Flyway's history table.
    }
    var flyway =
        Flyway.configure().dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword()).load();
    flyway.migrate();
    flyway.validate();
    assertThat(flyway.info().applied()).hasSize(15);
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      var after = snapshot(c);
      var expected = new HashSet<>(before.keySet());
      expected.addAll(Set.of("project", "style", "style_requirement", "style_material_selection"));
      assertThat(after.keySet()).containsExactlyInAnyOrderElementsOf(expected);
      before.forEach((table, rows) -> assertThat(after.get(table)).as(table).isEqualTo(rows));
      assertThat(after.get("project")).isEmpty();
      assertThat(after.get("style")).isEmpty();
      assertThat(after.get("style_requirement")).isEmpty();
      assertThat(after.get("style_material_selection")).isEmpty();
      assertThat(after).hasSize(44); // 45 including history.
      q.execute(
          "INSERT INTO project(id,organization_id,name)"
              + " VALUES('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','New"
              + " private Project')");
      q.execute(
          "INSERT INTO style(id,project_id,name)"
              + " VALUES(gen_random_uuid(),'99999999-9999-4999-8999-999999999999','New private"
              + " Style')");
      assertThat(q.executeQuery("SELECT count(*) FROM style").next()).isTrue();
    }
  }

  private Map<String, List<String>> snapshot(Connection c) throws SQLException {
    var tables = new ArrayList<String>();
    try (var q = c.createStatement();
        var r =
            q.executeQuery(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND"
                    + " table_type='BASE TABLE' AND table_name<>'flyway_schema_history' ORDER BY"
                    + " table_name")) {
      while (r.next()) tables.add(r.getString(1));
    }
    var rows = new LinkedHashMap<String, List<String>>();
    for (String table : tables) {
      var values = new ArrayList<String>();
      try (var q = c.createStatement();
          var r = q.executeQuery("SELECT row_to_json(t)::text FROM " + table + " t ORDER BY 1")) {
        while (r.next()) values.add(r.getString(1));
      }
      rows.put(table, values);
    }
    return rows;
  }
}
