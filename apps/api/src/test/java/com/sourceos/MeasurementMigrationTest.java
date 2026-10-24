package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class MeasurementMigrationTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  @Test
  void populatedV17UpgradePreservesEveryRowAndAddsOnlyEmptyMeasurementTables() throws Exception {
    var source =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("17")
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
      q.execute(
          "INSERT INTO style_requirement(style_id,notes)"
              + " VALUES('33333333-3333-4333-8333-333333333333','Synthetic existing requirement')");
      q.execute(
          "INSERT INTO supplier_profile(id,country_id,display_name,normalized_name) SELECT"
              + " '44444444-4444-4444-8444-444444444444',id,'Synthetic catalog"
              + " supplier','synthetic' FROM country WHERE alpha2='KR'");
      q.execute(
          "INSERT INTO"
              + " material(id,catalog_supplier_id,material_type,display_name,normalized_name,status)"
              + " VALUES('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','FABRIC','Synthetic"
              + " material','synthetic','ACTIVE')");
      q.execute(
          "INSERT INTO material_variant(id,material_id,variant_name)"
              + " VALUES('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555','Synthetic"
              + " variant')");
      q.execute(
          "INSERT INTO supplier_material_listing(id,material_id,seller_supplier_id)"
              + " VALUES('77777777-7777-4777-8777-777777777777','55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444')");
      q.execute(
          "INSERT INTO facility(id,supplier_id,facility_type,name,country_id) SELECT"
              + " '88888888-8888-4888-8888-888888888888',id,'FACTORY','Synthetic existing"
              + " Facility',country_id FROM supplier_profile WHERE"
              + " id='44444444-4444-4444-8444-444444444444'");
      q.execute(
          "INSERT INTO style_material_selection(id,style_id,material_id,variant_id,listing_id)"
              + " VALUES(gen_random_uuid(),'33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777')");
      q.execute(
          "INSERT INTO style_facility_candidate(id,style_id,facility_id)"
              + " VALUES(gen_random_uuid(),'33333333-3333-4333-8333-333333333333','88888888-8888-4888-8888-888888888888')");
      q.execute(
          "INSERT INTO"
              + " style_development_reference(id,style_id,storage_object_id,display_name,media_type,size_bytes,state)"
              + " VALUES(gen_random_uuid(),'33333333-3333-4333-8333-333333333333',gen_random_uuid(),'Synthetic"
              + " V17 reference','application/octet-stream',1,'PENDING')");
      before = snapshot(c);
      assertThat(before).hasSize(46);
    }
    var upgraded =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("18")
            .load();
    upgraded.migrate();
    upgraded.validate();
    assertThat(upgraded.info().applied()).hasSize(18);
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      var after = snapshot(c);
      assertThat(after).hasSize(49);
      var tables = new HashSet<>(before.keySet());
      tables.addAll(Set.of("measurement_spec", "measurement_revision", "measurement_point"));
      assertThat(after.keySet()).containsExactlyInAnyOrderElementsOf(tables);
      before.forEach((name, rows) -> assertThat(after.get(name)).as(name).isEqualTo(rows));
      for (String table : List.of("measurement_spec", "measurement_revision", "measurement_point"))
        assertThat(after.get(table)).isEmpty();
      c.setAutoCommit(false);
      q.execute(
          "INSERT INTO measurement_spec(id,style_id)"
              + " VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333')");
      q.execute(
          "INSERT INTO"
              + " measurement_revision(id,measurement_spec_id,style_id,revision_number,base_size,unit_system,created_by_issuer,created_by_subject)"
              + " VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333',1,'M','CM','urn:synthetic','synthetic')");
      q.execute(
          "INSERT INTO measurement_point(measurement_revision_id,position,code,label,value)"
              + " VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',0,'CHEST','Chest',50)");
      q.execute(
          "UPDATE measurement_revision SET sealed=true WHERE"
              + " id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'");
      c.commit();
    }
  }

  @Test
  void freshV18HasExactInventory() throws Exception {
    String name = "measurement_fresh_" + UUID.randomUUID().toString().replace("-", "");
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      q.execute("CREATE DATABASE " + name);
    }
    String url = "jdbc:postgresql://" + db.getHost() + ":" + db.getMappedPort(5432) + "/" + name;
    var f = Flyway.configure().dataSource(url, db.getUsername(), db.getPassword()).load();
    f.migrate();
    f.validate();
    assertThat(f.info().applied()).hasSize(18);
    try (var c = DriverManager.getConnection(url, db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      var r =
          q.executeQuery(
              "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND"
                  + " table_type='BASE TABLE'");
      r.next();
      assertThat(r.getInt(1)).isEqualTo(50);
      assertThat(snapshot(c)).hasSize(49);
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
