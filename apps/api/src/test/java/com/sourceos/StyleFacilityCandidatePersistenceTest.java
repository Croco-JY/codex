package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class StyleFacilityCandidatePersistenceTest extends StyleFacilityCandidateSupport {
  @Test
  void databaseIdentityUniqueForeignKeysAndUnlinkGuards() throws Exception {
    var columns =
        jdbc.sql(
                "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND"
                    + " table_name='style_facility_candidate' ORDER BY ordinal_position")
            .query(String.class)
            .list();
    assertThat(columns).containsExactly("id", "style_id", "facility_id", "created_at");
    try (var c = DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      try {
        String insert =
            "INSERT INTO style_facility_candidate(id,style_id,facility_id)"
                + " VALUES(gen_random_uuid(),'"
                + style.id()
                + "','"
                + facility
                + "')";
        q.execute(insert);
        var point = c.setSavepoint();
        assertThatThrownBy(() -> q.execute(insert))
            .isInstanceOf(SQLException.class)
            .hasMessageContaining("style_facility_candidate_scope_uq");
        c.rollback(point);
        q.execute(
            "INSERT INTO style_facility_candidate(id,style_id,facility_id)"
                + " VALUES(gen_random_uuid(),'"
                + foreignStyle.id()
                + "','"
                + facility
                + "')");
        q.execute(
            "INSERT INTO style_facility_candidate(id,style_id,facility_id)"
                + " VALUES(gen_random_uuid(),'"
                + style.id()
                + "','"
                + otherFacility
                + "')");
        var row =
            q.executeQuery(
                "SELECT id FROM style_facility_candidate WHERE style_id='"
                    + style.id()
                    + "' AND facility_id='"
                    + facility
                    + "'");
        row.next();
        var edge = row.getObject(1, UUID.class);
        for (String change :
            List.of(
                "id=gen_random_uuid()",
                "style_id='" + foreignStyle.id() + "'",
                "facility_id='" + otherFacility + "'",
                "created_at=created_at+interval '1 second'")) {
          point = c.setSavepoint();
          assertThatThrownBy(
                  () ->
                      q.execute(
                          "UPDATE style_facility_candidate SET "
                              + change
                              + " WHERE id='"
                              + edge
                              + "'"))
              .isInstanceOf(SQLException.class)
              .hasMessageContaining("Candidate identity is immutable");
          c.rollback(point);
        }
        for (String values :
            List.of(
                "gen_random_uuid(),'" + facility + "'", "'" + style.id() + "',gen_random_uuid()")) {
          point = c.setSavepoint();
          assertThatThrownBy(
                  () ->
                      q.execute(
                          "INSERT INTO style_facility_candidate(id,style_id,facility_id)"
                              + " VALUES(gen_random_uuid(),"
                              + values
                              + ")"))
              .isInstanceOf(SQLException.class)
              .hasMessageContaining("foreign key");
          c.rollback(point);
        }
        point = c.setSavepoint();
        assertThatThrownBy(() -> q.execute("TRUNCATE style_facility_candidate"))
            .isInstanceOf(SQLException.class)
            .hasMessageContaining("Workspace rows cannot be deleted or truncated");
        c.rollback(point);
        var counts = new LinkedHashMap<String, Long>();
        for (String table : List.of("style", "facility", "supplier_profile", "audit_event")) {
          var rs = q.executeQuery("SELECT count(*) FROM " + table);
          rs.next();
          counts.put(table, rs.getLong(1));
        }
        assertThat(q.executeUpdate("DELETE FROM style_facility_candidate WHERE id='" + edge + "'"))
            .isEqualTo(1);
        for (var e : counts.entrySet()) {
          var rs = q.executeQuery("SELECT count(*) FROM " + e.getKey());
          rs.next();
          assertThat(rs.getLong(1)).isEqualTo(e.getValue());
        }
      } finally {
        c.rollback();
      }
    }
  }

  @Test
  void facilityShareLockDoesNotLockSupplier() throws Exception {
    transaction()
        .executeWithoutResult(
            t -> {
              add();
              try (var c =
                      DriverManager.getConnection(
                          DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
                  var q = c.createStatement()) {
                c.setAutoCommit(false);
                try {
                  assertThat(
                          q.executeQuery(
                                  "SELECT id FROM supplier_profile WHERE id='"
                                      + supplier
                                      + "' FOR UPDATE NOWAIT")
                              .next())
                      .isTrue();
                  var point = c.setSavepoint();
                  assertThatThrownBy(
                          () ->
                              q.executeQuery(
                                  "SELECT id FROM facility WHERE id='"
                                      + facility
                                      + "' FOR UPDATE NOWAIT"))
                      .isInstanceOfSatisfying(
                          SQLException.class, e -> assertThat(e.getSQLState()).isEqualTo("55P03"));
                  c.rollback(point);
                } finally {
                  c.rollback();
                }
              } catch (SQLException e) {
                throw new IllegalStateException(e);
              }
            });
  }
}
