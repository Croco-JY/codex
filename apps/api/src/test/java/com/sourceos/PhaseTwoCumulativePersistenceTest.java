package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class PhaseTwoCumulativePersistenceTest extends PhaseTwoCumulativeSupport {
  @Test
  void destructionPoliciesRemainDistinctAndAuditIsAppendOnly() throws Exception {
    try (var c = DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      var rows = new LinkedHashMap<String, UUID>();
      rows.put("project", project.id());
      rows.put("style", style.id());
      rows.put("style_requirement", style.id());
      rows.put("style_material_selection", selection);
      rows.put("style_facility_candidate", candidate);
      rows.put("style_development_reference", reference.id());
      for (var entry : rows.entrySet()) {
        String table = entry.getKey(), key = table.equals("style_requirement") ? "style_id" : "id";
        boolean unlink =
            Set.of("style_material_selection", "style_facility_candidate").contains(table);
        var save = c.setSavepoint();
        String deletion = "DELETE FROM " + table + " WHERE " + key + "='" + entry.getValue() + "'";
        if (unlink) assertThat(q.executeUpdate(deletion)).isEqualTo(1);
        else
          assertThatThrownBy(() -> q.execute(deletion))
              .isInstanceOf(SQLException.class)
              .hasMessageContaining("Workspace rows cannot be deleted or truncated");
        c.rollback(save);
        save = c.setSavepoint();
        assertThatThrownBy(() -> q.execute("TRUNCATE " + table + " CASCADE"))
            .isInstanceOf(SQLException.class)
            .hasMessageContaining("Workspace rows cannot be deleted or truncated");
        c.rollback(save);
      }
      String audit =
          jdbc.sql("SELECT id::text FROM audit_event WHERE entity_id=:id LIMIT 1")
              .param("id", reference.id())
              .query(String.class)
              .single();
      for (String sql :
          List.of(
              "UPDATE audit_event SET action='synthetic' WHERE id='" + audit + "'",
              "DELETE FROM audit_event WHERE id='" + audit + "'",
              "TRUNCATE audit_event")) {
        var save = c.setSavepoint();
        assertThatThrownBy(() -> q.execute(sql))
            .isInstanceOf(SQLException.class)
            .hasMessageContaining("audit_event is append-only");
        c.rollback(save);
      }
      c.rollback();
    }
    assertThat(children().get("style_material_selection")).hasSize(1);
    assertThat(children().get("style_facility_candidate")).hasSize(1);
  }

  @Test
  void criticalLatestConstraintsAndSchemaInventoryRemainExact() {
    assertThat(
            jdbc.sql("SELECT count(*) FROM flyway_schema_history WHERE success")
                .query(Integer.class)
                .single())
        .isEqualTo(18);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND"
                        + " table_type='BASE TABLE'")
                .query(Integer.class)
                .single())
        .isEqualTo(50);
    assertThat(
            jdbc.sql(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE"
                        + " conrelid='style_requirement'::regclass AND contype='p'")
                .query(String.class)
                .single())
        .isEqualTo("PRIMARY KEY (style_id)");
    assertThat(
            jdbc.sql(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE"
                        + " conname='style_material_selection_scope_uq'")
                .query(String.class)
                .single())
        .isEqualTo("UNIQUE NULLS NOT DISTINCT (style_id, material_id, variant_id, listing_id)");
    var fks =
        jdbc.sql(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE"
                    + " conrelid='style_material_selection'::regclass AND contype='f'")
            .query(String.class)
            .list();
    assertThat(fks)
        .anyMatch(
            v ->
                v.contains(
                    "FOREIGN KEY (variant_id, material_id) REFERENCES material_variant(id,"
                        + " material_id)"));
    assertThat(fks)
        .anyMatch(
            v ->
                v.contains(
                    "FOREIGN KEY (listing_id, material_id) REFERENCES supplier_material_listing(id,"
                        + " material_id)"));
    assertThat(
            jdbc.sql(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE"
                        + " conname='style_facility_candidate_scope_uq'")
                .query(String.class)
                .single())
        .isEqualTo("UNIQUE (style_id, facility_id)");
    assertThat(
            jdbc.sql(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE"
                        + " conrelid='style_development_reference'::regclass AND contype='u'")
                .query(String.class)
                .list())
        .containsExactly("UNIQUE (storage_object_id)");
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM pg_trigger WHERE"
                        + " tgrelid='style_development_reference'::regclass AND"
                        + " tgname='style_development_reference_transition' AND tgenabled='O'")
                .query(Integer.class)
                .single())
        .isEqualTo(1);
  }

  @Test
  void childAuditsKeepOnlyAcceptedScalarIdentityAndBookkeeping() {
    var allow =
        Map.of(
            "StyleRequirement",
            Set.of("styleId", "version"),
            "StyleMaterialSelection",
            Set.of("styleId", "materialId", "variantId", "listingId"),
            "StyleFacilityCandidate",
            Set.of("styleId", "facilityId"),
            "StyleDevelopmentReference",
            Set.of("styleId", "state", "version", "sizeBytes"));
    var rows =
        jdbc.sql(
                "SELECT entity_type,before_state::text,after_state::text FROM audit_event WHERE"
                    + " organization_id=:org")
            .param("org", org)
            .query()
            .listOfRows();
    for (var r : rows) {
      var expected = allow.get(r.get("entity_type"));
      if (expected == null) continue;
      for (String column : List.of("before_state", "after_state"))
        if (r.get(column) != null) {
          var state = json.readTree((String) r.get(column));
          assertThat(state.propertyNames()).containsExactlyInAnyOrderElementsOf(expected);
        }
    }
    long before = audits();
    actor(owner);
    assertThatThrownBy(
            () ->
                transaction()
                    .executeWithoutResult(
                        t ->
                            audit.organizationChanged(
                                org,
                                "synthetic.invalid",
                                "Style",
                                style.id(),
                                "cumulative-invalid",
                                null,
                                Map.of("arbitraryUnsupportedField", "synthetic"))))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(audits()).isEqualTo(before);
  }
}
