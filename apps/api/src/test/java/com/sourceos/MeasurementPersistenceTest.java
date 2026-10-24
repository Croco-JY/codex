package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class MeasurementPersistenceTest extends MeasurementSupport {
  Connection connection() throws SQLException {
    return DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
  }

  UUID spec(Statement q, UUID style) throws SQLException {
    var s = id();
    q.execute("INSERT INTO measurement_spec(id,style_id) VALUES('" + s + "','" + style + "')");
    return s;
  }

  UUID revision(Statement q, UUID s, UUID style, long n, boolean sealed) throws SQLException {
    var r = id();
    q.execute(
        "INSERT INTO"
            + " measurement_revision(id,measurement_spec_id,style_id,revision_number,base_size,unit_system,created_by_issuer,created_by_subject,sealed)"
            + " VALUES('"
            + r
            + "','"
            + s
            + "','"
            + style
            + "',"
            + n
            + ",'M','CM','urn:synthetic','synthetic',"
            + sealed
            + ")");
    return r;
  }

  void point(Statement q, UUID r, int position, String code) throws SQLException {
    q.execute(
        "INSERT INTO measurement_point(measurement_revision_id,position,code,label,value) VALUES('"
            + r
            + "',"
            + position
            + ",'"
            + code
            + "','Chest',50)");
  }

  void seal(Statement q, UUID r) throws SQLException {
    q.execute("UPDATE measurement_revision SET sealed=true WHERE id='" + r + "'");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "no-revision",
        "unsealed",
        "zero",
        "gap",
        "too-many",
        "starts-two",
        "already-sealed"
      })
  void invalidConstructionCannotCommit(String kind) throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      assertThatThrownBy(
              () -> {
                var s = spec(q, style.id());
                if (!kind.equals("no-revision")) {
                  var r =
                      revision(
                          q,
                          s,
                          style.id(),
                          kind.equals("starts-two") ? 2 : 1,
                          kind.equals("already-sealed"));
                  if (!kind.equals("zero")) {
                    if (kind.equals("too-many"))
                      for (int n = 0; n < 501; n++) point(q, r, n, "P" + n);
                    else point(q, r, kind.equals("gap") ? 1 : 0, "CHEST");
                  }
                  if (!kind.equals("unsealed") && !kind.equals("already-sealed")) seal(q, r);
                }
                c.commit();
              })
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
    assertThat(count("measurement_spec")).isZero();
  }

  @Test
  void legitimateFiveHundredPointConstructionAndNoLaterPointWrites() throws Exception {
    UUID r;
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      var s = spec(q, style.id());
      r = revision(q, s, style.id(), 1, false);
      for (int n = 0; n < 500; n++) point(q, r, n, "P" + n);
      seal(q, r);
      c.commit();
      c.setAutoCommit(false);
      for (String sql :
          List.of(
              "UPDATE measurement_spec SET created_at=created_at WHERE id='" + s + "'",
              "DELETE FROM measurement_spec WHERE id='" + s + "'",
              "TRUNCATE measurement_spec CASCADE",
              "UPDATE measurement_revision SET base_size='L' WHERE id='" + r + "'",
              "UPDATE measurement_revision SET sealed=false WHERE id='" + r + "'",
              "UPDATE measurement_revision SET sealed=true WHERE id='" + r + "'",
              "DELETE FROM measurement_revision WHERE id='" + r + "'",
              "TRUNCATE measurement_revision CASCADE",
              "UPDATE measurement_point SET value=1 WHERE measurement_revision_id='" + r + "'",
              "DELETE FROM measurement_point WHERE measurement_revision_id='" + r + "'",
              "TRUNCATE measurement_point")) {
        var save = c.setSavepoint();
        assertThatThrownBy(() -> q.execute(sql)).as(sql).isInstanceOf(SQLException.class);
        c.rollback(save);
      }
      var save = c.setSavepoint();
      assertThatThrownBy(() -> point(q, r, 0, "ADDED_LATER"))
          .isInstanceOf(SQLException.class)
          .hasMessageContaining("not under construction");
      c.rollback(save);
      c.rollback();
    }
    assertThat(count("measurement_point")).isEqualTo(500);
    actor(owner);
    assertThat(measurements.read(org, project.id(), style.id()).latestRevision().points())
        .hasSize(500);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "duplicate-code",
        "duplicate-position",
        "lowercase",
        "negative-position",
        "label-space",
        "label-tab",
        "value-negative",
        "value-large",
        "plus-negative",
        "minus-negative",
        "notes-space",
        "base-space",
        "base-tab",
        "unit",
        "owner",
        "skip",
        "duplicate-revision",
        "first-seal-metadata"
      })
  void relationalAndImmutableConstraints(String kind) throws Exception {
    var existing = create();
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      assertThatThrownBy(
              () -> {
                long num = kind.equals("skip") ? 3 : kind.equals("duplicate-revision") ? 1 : 2;
                var r =
                    revision(
                        q,
                        existing.id(),
                        kind.equals("owner") ? foreignStyle.id() : style.id(),
                        num,
                        false);
                point(q, r, 0, "CHEST");
                switch (kind) {
                  case "duplicate-code" -> point(q, r, 1, "CHEST");
                  case "duplicate-position" -> point(q, r, 0, "SECOND");
                  case "lowercase" -> point(q, r, 1, "lower");
                  case "negative-position" -> point(q, r, -1, "SECOND");
                  case "label-space",
                      "label-tab",
                      "value-negative",
                      "value-large",
                      "plus-negative",
                      "minus-negative",
                      "notes-space" -> {
                    String values =
                        switch (kind) {
                          case "label-space" -> "' Chest',1,NULL,NULL,NULL";
                          case "label-tab" -> "E'Chest\\t',1,NULL,NULL,NULL";
                          case "value-negative" -> "'Chest',-1,NULL,NULL,NULL";
                          case "value-large" -> "'Chest',1000000000000000,NULL,NULL,NULL";
                          case "plus-negative" -> "'Chest',1,-1,NULL,NULL";
                          case "minus-negative" -> "'Chest',1,NULL,-1,NULL";
                          default -> "'Chest',1,NULL,NULL,' note '";
                        };
                    q.execute(
                        "INSERT INTO"
                            + " measurement_point(measurement_revision_id,position,code,label,value,tolerance_plus,tolerance_minus,notes)"
                            + " VALUES('"
                            + r
                            + "',1,'SECOND',"
                            + values
                            + ")");
                  }
                  case "base-space", "base-tab", "unit" -> {
                    // A fresh revision attempt exercises insertion checks, not the immutable update
                    // guard.
                    q.execute(
                        "INSERT INTO"
                            + " measurement_revision(id,measurement_spec_id,style_id,revision_number,base_size,unit_system,created_by_issuer,created_by_subject)"
                            + " VALUES(gen_random_uuid(),'"
                            + existing.id()
                            + "','"
                            + style.id()
                            + "',3,"
                            + (kind.equals("base-space")
                                ? "' M'"
                                : kind.equals("base-tab") ? "E'M\\t'" : "'M'")
                            + ","
                            + (kind.equals("unit") ? "'XX'" : "'CM'")
                            + ",'urn:synthetic','synthetic')");
                  }
                  case "first-seal-metadata" ->
                      q.execute(
                          "UPDATE measurement_revision SET sealed=true,base_size='L' WHERE id='"
                              + r
                              + "'");
                  default -> throw new AssertionError(kind);
                }
              })
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
    assertThat(count("measurement_revision")).isEqualTo(1);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "id=gen_random_uuid()",
        "measurement_spec_id=gen_random_uuid()",
        "style_id=gen_random_uuid()",
        "revision_number=revision_number+1",
        "base_size='L'",
        "unit_system='MM'",
        "created_by_issuer='urn:other'",
        "created_by_subject='other'",
        "created_at=created_at+interval '1 second'",
        "sealed=false",
        "sealed=true"
      })
  void everyCommittedRevisionColumnIsImmutable(String assignment) throws Exception {
    var r = create().latestRevision();
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      assertThatThrownBy(
              () ->
                  q.execute(
                      "UPDATE measurement_revision SET "
                          + assignment
                          + " WHERE id='"
                          + r.id()
                          + "'"))
          .isInstanceOf(SQLException.class)
          .hasMessageContaining("immutable");
      c.rollback();
    }
  }

  @Test
  void futureOwnerAwareKeysAndStyleSingletonAreDurable() throws Exception {
    var s = create();
    var definitions =
        jdbc.sql(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid IN"
                    + " ('measurement_spec'::regclass,'measurement_revision'::regclass)")
            .query(String.class)
            .list();
    assertThat(definitions)
        .contains(
            "UNIQUE (id, style_id)",
            "UNIQUE (measurement_spec_id, revision_number)",
            "FOREIGN KEY (measurement_spec_id, style_id) REFERENCES measurement_spec(id, style_id)",
            "UNIQUE (style_id)");
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      assertThatThrownBy(() -> spec(q, style.id())).isInstanceOf(SQLException.class);
      c.rollback();
    }
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM information_schema.columns WHERE"
                        + " table_name='measurement_revision' AND column_name IN"
                        + " ('status','version','current_revision_id')")
                .query(Integer.class)
                .single())
        .isZero();
  }
}
