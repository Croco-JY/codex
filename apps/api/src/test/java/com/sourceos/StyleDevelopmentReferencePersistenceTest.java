package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class StyleDevelopmentReferencePersistenceTest extends StyleDevelopmentReferenceSupport {
  @Test
  void relationalConstraintsImmutableMetadataStateMachineAndDestructionGuards() throws Exception {
    var cols =
        jdbc.sql(
                "SELECT column_name FROM information_schema.columns WHERE"
                    + " table_name='style_development_reference' ORDER BY ordinal_position")
            .query(String.class)
            .list();
    assertThat(cols)
        .containsExactly(
            "id",
            "style_id",
            "storage_object_id",
            "display_name",
            "media_type",
            "size_bytes",
            "state",
            "version",
            "created_at",
            "updated_at");
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM information_schema.columns WHERE"
                        + " table_name='style_development_reference' AND data_type IN"
                        + " ('bytea','oid')")
                .query(Long.class)
                .single())
        .isZero();
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM information_schema.key_column_usage k JOIN"
                        + " information_schema.table_constraints t"
                        + " USING(constraint_catalog,constraint_schema,constraint_name) WHERE"
                        + " k.table_name='style_development_reference' AND"
                        + " k.column_name='storage_object_id' AND t.constraint_type='FOREIGN KEY'")
                .query(Long.class)
                .single())
        .isZero();
    try (var c = DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      String id = UUID.randomUUID().toString(), object = UUID.randomUUID().toString();
      String insert =
          "INSERT INTO"
              + " style_development_reference(id,style_id,storage_object_id,display_name,media_type,size_bytes,state)"
              + " VALUES('"
              + id
              + "','"
              + style.id()
              + "','"
              + object
              + "','Synthetic file','application/octet-stream',3,'PENDING')";
      q.execute(insert);
      for (String sql :
          List.of(
              insert.replace(id, UUID.randomUUID().toString()),
              insert
                  .replace(id, UUID.randomUUID().toString())
                  .replace(object, UUID.randomUUID().toString())
                  .replace(",3,", ",0,"),
              insert
                  .replace(id, UUID.randomUUID().toString())
                  .replace(object, UUID.randomUUID().toString())
                  .replace(",3,", ",10485761,"),
              insert
                  .replace(id, UUID.randomUUID().toString())
                  .replace(object, UUID.randomUUID().toString())
                  .replace("application/octet-stream", "image/png"),
              insert
                  .replace(id, UUID.randomUUID().toString())
                  .replace(object, UUID.randomUUID().toString())
                  .replace("Synthetic file", "../secret"),
              insert
                  .replace(id, UUID.randomUUID().toString())
                  .replace(object, UUID.randomUUID().toString())
                  .replace("'PENDING'", "'OTHER'"),
              "DELETE FROM style_development_reference WHERE id='" + id + "'",
              "TRUNCATE style_development_reference")) {
        var save = c.setSavepoint();
        assertThatThrownBy(() -> q.execute(sql)).isInstanceOf(SQLException.class);
        c.rollback(save);
      }
      for (String name : List.of("", " ", ".", "..", "a\\b", "line\nbreak", "a".repeat(256))) {
        var save = c.setSavepoint();
        String sql =
            insert
                .replace(id, UUID.randomUUID().toString())
                .replace(object, UUID.randomUUID().toString())
                .replace("Synthetic file", name);
        assertThatThrownBy(() -> q.execute(sql)).isInstanceOf(SQLException.class);
        c.rollback(save);
      }
      String where = " WHERE id='" + id + "'";
      for (String change :
          List.of(
              "id=gen_random_uuid()",
              "style_id='" + foreignStyle.id() + "'",
              "storage_object_id=gen_random_uuid()",
              "display_name='Other'",
              "media_type='text/html'",
              "size_bytes=4",
              "created_at=created_at+interval '1 second'",
              "version=-1",
              "version=2",
              "version=0",
              "state='PENDING',version=1",
              "state='READY',version=2",
              "state='READY',version=1")) {
        var save = c.setSavepoint();
        assertThatThrownBy(
                () -> q.execute("UPDATE style_development_reference SET " + change + where))
            .isInstanceOf(SQLException.class);
        c.rollback(save);
      }
      for (String identity :
          List.of(
              "id=gen_random_uuid()",
              "style_id='" + foreignStyle.id() + "'",
              "storage_object_id=gen_random_uuid()",
              "display_name='Other'",
              "size_bytes=4",
              "created_at=created_at+interval '1 second'")) {
        var save = c.setSavepoint();
        assertThatThrownBy(
                () ->
                    q.execute(
                        "UPDATE style_development_reference SET"
                            + " state='READY',version=1,updated_at=clock_timestamp()+interval '1"
                            + " second',"
                            + identity
                            + where))
            .isInstanceOf(SQLException.class)
            .hasMessageContaining("Invalid development reference transition");
        c.rollback(save);
      }
      for (String first : List.of("READY", "FAILED", "DETACHED")) {
        var save = c.setSavepoint();
        q.execute(
            "UPDATE style_development_reference SET state='"
                + first
                + "',version=1,updated_at=clock_timestamp()+interval '1 second'"
                + where);
        for (String next : List.of("PENDING", "READY", "FAILED", "DETACHED")) {
          var step = c.setSavepoint();
          String sql =
              "UPDATE style_development_reference SET state='"
                  + next
                  + "',version=2,updated_at=clock_timestamp()+interval '2 seconds'"
                  + where;
          if (!first.equals("DETACHED") && next.equals("DETACHED")) q.execute(sql);
          else assertThatThrownBy(() -> q.execute(sql)).isInstanceOf(SQLException.class);
          c.rollback(step);
        }
        c.rollback(save);
      }
      c.rollback();
    }
  }
}
