package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class PhaseOneBMigrationTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  @Test
  void reviewedV1ThroughV8AreByteForByteUnchanged() throws Exception {
    Map<String, String> expected =
        Map.ofEntries(
            Map.entry(
                "V7__supplier_directory.sql",
                "0bbbcf14e0c2d3c371971d948a3e2a9df9814ca2474565b1001e5cbe4a0e3606"),
            Map.entry(
                "V8__facility_capability.sql",
                "3b77d05f59ad3d9cd20dba9541228000028bcb98947108dcc37484e2ca0af328"),
            Map.entry(
                "V3__audit_platform_scope.sql",
                "4296815f3c3086d46db35585e213bb31d1cbff1463bb13ee3c77042a7bed4bc4"),
            Map.entry(
                "V4__platform_role_assignment.sql",
                "aa0ebcac1e395c8b17a4c913f51b8355b07c015d3c217a808a2b58939b1c72de"),
            Map.entry(
                "V2__audit_truncate_guard.sql",
                "fc20bd761ff860735807451aa1d9090ae55a1f0e70fc0164c4ba84e24a07b8c7"),
            Map.entry(
                "V1__foundation.sql",
                "ce595ff5a066da9afcd2e734365cd063a50cba3fac6e7a54ed9ada932a47e8df"),
            Map.entry(
                "V6__external_source_identity.sql",
                "2c2af202b40ae43646ea8a0a85674d6b33801d90f3e2d818efcf87a8802cedc5"),
            Map.entry(
                "V5__geography.sql",
                "549e38abc630e56243a2e431fe67a59d66da4a97781a03526b0bdd16a6fed6fd"));
    for (var e : expected.entrySet()) {
      try (var input = getClass().getResourceAsStream("/db/migration/" + e.getKey())) {
        assertThat(input).isNotNull();
        assertThat(
                HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(input.readAllBytes())))
            .as(e.getKey())
            .isEqualTo(e.getValue());
      }
    }
  }

  @Test
  void populatedV8UpgradesWithoutChangingExistingCanonicalOrAuditRows() throws Exception {
    var old =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("8")
            .load();
    old.migrate();
    old.validate();
    UUID org = UUID.randomUUID(),
        supplier = UUID.randomUUID(),
        facility = UUID.randomUUID(),
        source = UUID.randomUUID(),
        record = UUID.randomUUID(),
        siteRecord = UUID.randomUUID(),
        observation = UUID.randomUUID(),
        capability = UUID.randomUUID();
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        var q = c.createStatement()) {
      q.execute(
          "INSERT INTO organization(id,name) VALUES('" + org + "','Synthetic legacy tenant')");
      q.execute(
          "INSERT INTO membership(id,organization_id,issuer,subject,role)"
              + " VALUES(gen_random_uuid(),'"
              + org
              + "','fixture-issuer','fixture-owner','ORG_OWNER')");
      q.execute(
          "INSERT INTO supplier_profile(id,country_id,display_name,normalized_name) VALUES('"
              + supplier
              + "','00000000-0000-4000-8000-000000000002','Synthetic V8 supplier','synthetic v8"
              + " supplier')");
      q.execute("INSERT INTO supplier_role VALUES('" + supplier + "','MILL')");
      q.execute(
          "INSERT INTO supplier_alias(id,supplier_id,alias,normalized_alias,alias_type)"
              + " VALUES(gen_random_uuid(),'"
              + supplier
              + "','V8 preserved alias','v8 preserved alias','ORIGINAL')");
      q.execute(
          "INSERT INTO"
              + " supplier_organization_link(id,supplier_profile_id,organization_id,status,linked_by_issuer,linked_by_subject)"
              + " VALUES(gen_random_uuid(),'"
              + supplier
              + "','"
              + org
              + "','ACTIVE','fixture-issuer','fixture-operator')");
      q.execute(
          "INSERT INTO facility(id,supplier_id,facility_type,name,country_id) VALUES('"
              + facility
              + "','"
              + supplier
              + "','MILL','Synthetic V8 site','00000000-0000-4000-8000-000000000003')");
      q.execute(
          "INSERT INTO capability(id,code,category,name_en) VALUES('"
              + capability
              + "','V8_PROCESS','PROCESS','Synthetic V8 process')");
      q.execute(
          "INSERT INTO facility_capability(facility_id,capability_id,verification_status) VALUES('"
              + facility
              + "','"
              + capability
              + "','UNVERIFIED')");
      q.execute(
          "INSERT INTO data_source(id,source_code,source_type,name,access_method) VALUES('"
              + source
              + "','v8-fixture','MANUAL_ENTRY','Synthetic V8 provider','MANUAL')");
      q.execute(
          "INSERT INTO"
              + " data_source_record(id,data_source_id,record_kind,external_record_key,normalized_external_record_key)"
              + " VALUES('"
              + record
              + "','"
              + source
              + "','SUPPLIER',' MiXeD ',' MiXeD '),('"
              + siteRecord
              + "','"
              + source
              + "','FACILITY','Site','Site')");
      q.execute(
          "INSERT INTO data_source_observation(id,source_record_id,observation_key,observed_at)"
              + " VALUES('"
              + observation
              + "','"
              + record
              + "','v8-observation','2026-10-01T00:00:00Z')");
      q.execute(
          "INSERT INTO"
              + " data_source_observation_review(id,observation_id,review_status,reviewed_by_issuer,reviewed_by_subject)"
              + " VALUES(gen_random_uuid(),'"
              + observation
              + "','ACCEPTED','fixture-issuer','fixture-reviewer')");
      q.execute(
          "INSERT INTO supplier_external_record(source_record_id,supplier_id) VALUES('"
              + record
              + "','"
              + supplier
              + "')");
      q.execute(
          "INSERT INTO facility_external_record(source_record_id,facility_id) VALUES('"
              + siteRecord
              + "','"
              + facility
              + "')");
      q.execute(
          "INSERT INTO supplier_source(supplier_id,source_observation_id,field_name) VALUES('"
              + supplier
              + "','"
              + observation
              + "','RECORD')");
      q.execute(
          "INSERT INTO facility_source(facility_id,source_observation_id,field_name) VALUES('"
              + facility
              + "','"
              + observation
              + "','RECORD')");
      q.execute(
          "INSERT INTO"
              + " supplier_verification_event(id,supplier_id,new_status,reason,actor_issuer,actor_subject,source_observation_id)"
              + " VALUES(gen_random_uuid(),'"
              + supplier
              + "','DISCOVERED','Synthetic legacy evidence','fixture-issuer','fixture-reviewer','"
              + observation
              + "')");
      q.execute(
          "INSERT INTO audit_event(id,actor_issuer,actor_subject,organization_id,action,request_id)"
              + " VALUES(gen_random_uuid(),'fixture-issuer','fixture-owner','"
              + org
              + "','legacy.fixture','legacy-request')");
      var before = snapshot(c);
      String listingInsert =
          "INSERT INTO"
              + " data_source_record(id,data_source_id,record_kind,external_record_key,normalized_external_record_key)"
              + " VALUES(gen_random_uuid(),'"
              + source
              + "','MATERIAL_LISTING','offer','offer')";
      assertThatThrownBy(() -> q.execute(listingInsert))
          .isInstanceOf(SQLException.class)
          .hasMessageContaining("data_source_record_kind_check");
      var upgraded =
          Flyway.configure().dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword()).load();
      upgraded.migrate();
      upgraded.validate();
      for (var entry : before.entrySet())
        assertThat(rows(c, entry.getKey()))
            .as("preserved V8 " + entry.getKey())
            .isEqualTo(entry.getValue());
      q.execute(listingInsert);
      assertThatThrownBy(
              () ->
                  q.execute(
                      "INSERT INTO"
                          + " data_source_record(id,data_source_id,record_kind,external_record_key,normalized_external_record_key)"
                          + " VALUES(gen_random_uuid(),'"
                          + source
                          + "','INVALID_KIND','bad','bad')"))
          .hasMessageContaining("data_source_record_kind_check");
      for (String sql :
          List.of(
              "UPDATE audit_event SET action=action",
              "DELETE FROM supplier_external_record",
              "TRUNCATE facility_external_record"))
        assertThatThrownBy(() -> q.execute(sql)).hasMessageContaining("append-only");
    }
  }

  private Map<String, List<String>> snapshot(Connection c) throws SQLException {
    Map<String, List<String>> result = new TreeMap<>();
    try (var q = c.createStatement();
        var r =
            q.executeQuery(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND"
                    + " table_type='BASE TABLE' AND table_name<>'flyway_schema_history' ORDER BY"
                    + " table_name")) {
      List<String> names = new ArrayList<>();
      while (r.next()) names.add(r.getString(1));
      for (String name : names) result.put(name, rows(c, name));
    }
    return result;
  }

  private List<String> rows(Connection c, String table) throws SQLException {
    try (var q = c.createStatement();
        var r = q.executeQuery("SELECT row_to_json(t)::text FROM " + table + " t ORDER BY 1")) {
      List<String> rows = new ArrayList<>();
      while (r.next()) rows.add(r.getString(1));
      return rows;
    }
  }
}
