package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class StyleMaterialSelectionPersistenceTest extends StyleMaterialSelectionSupport {
  @Test
  void nullUniquenessCompositeForeignKeysIdentityAndUnlinkGuards() throws Exception {
    try (var c = DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      try {
        for (boolean v : List.of(false, true))
          for (boolean l : List.of(false, true)) {
            String sql =
                "INSERT INTO"
                    + " style_material_selection(id,style_id,material_id,variant_id,listing_id)"
                    + " VALUES(gen_random_uuid(),'"
                    + style.id()
                    + "','"
                    + material
                    + "',"
                    + (v ? "'" + variant + "'" : "NULL")
                    + ","
                    + (l ? "'" + listing + "'" : "NULL")
                    + ")";
            q.execute(sql);
            var point = c.setSavepoint();
            assertThatThrownBy(() -> q.execute(sql))
                .isInstanceOf(SQLException.class)
                .hasMessageContaining("style_material_selection_scope_uq");
            c.rollback(point);
          }
        var row =
            q.executeQuery(
                "SELECT id FROM style_material_selection WHERE style_id='"
                    + style.id()
                    + "' LIMIT 1");
        row.next();
        var id = row.getObject(1, UUID.class);
        for (String change :
            List.of(
                "id=gen_random_uuid()",
                "style_id='" + foreignStyle.id() + "'",
                "material_id='" + otherMaterial + "'",
                "variant_id='" + otherVariant + "'",
                "listing_id='" + otherListing + "'",
                "created_at=created_at+interval '1 second'")) {
          var point = c.setSavepoint();
          assertThatThrownBy(
                  () ->
                      q.execute(
                          "UPDATE style_material_selection SET "
                              + change
                              + " WHERE id='"
                              + id
                              + "'"))
              .isInstanceOf(SQLException.class)
              .hasMessageContaining("Selection identity is immutable");
          c.rollback(point);
        }
        for (String refs : List.of("'" + otherVariant + "',NULL", "NULL,'" + otherListing + "'")) {
          var point = c.setSavepoint();
          assertThatThrownBy(
                  () ->
                      q.execute(
                          "INSERT INTO"
                              + " style_material_selection(id,style_id,material_id,variant_id,listing_id)"
                              + " VALUES(gen_random_uuid(),'"
                              + foreignStyle.id()
                              + "','"
                              + material
                              + "',"
                              + refs
                              + ")"))
              .isInstanceOf(SQLException.class)
              .hasMessageContaining("foreign key");
          c.rollback(point);
        }
        var point = c.setSavepoint();
        assertThatThrownBy(() -> q.execute("TRUNCATE style_material_selection"))
            .isInstanceOf(SQLException.class)
            .hasMessageContaining("Workspace rows cannot be deleted or truncated");
        c.rollback(point);
        var counts = new LinkedHashMap<String, Long>();
        for (String table :
            List.of("style", "material", "material_variant", "supplier_material_listing")) {
          var result = q.executeQuery("SELECT count(*) FROM " + table);
          result.next();
          counts.put(table, result.getLong(1));
        }
        assertThat(q.executeUpdate("DELETE FROM style_material_selection WHERE id='" + id + "'"))
            .isEqualTo(1);
        for (var entry : counts.entrySet()) {
          var result = q.executeQuery("SELECT count(*) FROM " + entry.getKey());
          result.next();
          assertThat(result.getLong(1)).isEqualTo(entry.getValue());
        }
      } finally {
        c.rollback();
      }
    }
  }
}
