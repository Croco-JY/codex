package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class PatternPersistenceTest extends PatternSupport {
  Connection connection() throws SQLException {
    return DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
  }

  String insert(UUID p, UUID style, long n, UUID pin) {
    return "INSERT INTO"
               + " pattern_revision(id,pattern_id,style_id,revision_number,name,measurement_revision_id,created_by_issuer,created_by_subject)"
               + " VALUES('"
        + id()
        + "','"
        + p
        + "','"
        + style
        + "',"
        + n
        + ",'Main',"
        + (pin == null ? "null" : "'" + pin + "'")
        + ",'urn:synthetic','synthetic')";
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "empty",
        "first-two",
        "initial-archived",
        "initial-version",
        "initial-unsafe",
        "invalid-status"
      })
  void invalidInitialConstruction(String kind) throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      assertThatThrownBy(
              () -> {
                var p = id();
                q.execute(
                    "INSERT INTO pattern(id,style_id,status,version) VALUES('"
                        + p
                        + "','"
                        + style.id()
                        + "','"
                        + (kind.equals("initial-archived")
                            ? "ARCHIVED"
                            : kind.equals("invalid-status") ? "INVALID" : "ACTIVE")
                        + "',"
                        + (kind.equals("initial-version")
                            ? 50
                            : kind.equals("initial-unsafe") ? 9007199254740992L : 0)
                        + ")");
                if (!kind.equals("empty"))
                  q.execute(insert(p, style.id(), kind.equals("first-two") ? 2 : 1, null));
                c.commit();
              })
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
    assertThat(patternCount("pattern")).isZero();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "skip",
        "duplicate",
        "pattern-owner",
        "pin-owner",
        "name-space",
        "purpose-space",
        "status",
        "identity",
        "style",
        "created",
        "version-jump",
        "same-status",
        "revision-update",
        "revision-delete",
        "revision-truncate",
        "pattern-delete",
        "pattern-truncate",
        "archived-append"
      })
  void durableIntegrity(String kind) throws Exception {
    var m = create();
    var p = pattern();
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      assertThatThrownBy(
              () -> {
                String sql =
                    switch (kind) {
                      case "skip" -> insert(p.id(), style.id(), 3, null);
                      case "duplicate" -> insert(p.id(), style.id(), 1, null);
                      case "pattern-owner" -> insert(p.id(), foreignStyle.id(), 2, null);
                      case "pin-owner" -> {
                        var other = id();
                        q.execute(
                            "INSERT INTO pattern(id,style_id) VALUES('"
                                + other
                                + "','"
                                + foreignStyle.id()
                                + "')");
                        yield insert(other, foreignStyle.id(), 1, m.latestRevision().id());
                      }
                      case "name-space" ->
                          insert(p.id(), style.id(), 2, null).replace("'Main'", "' Main'");
                      case "purpose-space" ->
                          "INSERT INTO"
                              + " pattern_revision(id,pattern_id,style_id,revision_number,name,purpose,created_by_issuer,created_by_subject)"
                              + " VALUES('"
                              + id()
                              + "','"
                              + p.id()
                              + "','"
                              + style.id()
                              + "',2,'Main',' ','urn:s','s')";
                      case "status" ->
                          "UPDATE pattern SET"
                              + " status='INVALID',version=1,updated_at=clock_timestamp() WHERE"
                              + " id='"
                              + p.id()
                              + "'";
                      case "identity" ->
                          "UPDATE pattern SET id='" + id() + "' WHERE id='" + p.id() + "'";
                      case "style" ->
                          "UPDATE pattern SET style_id='"
                              + foreignStyle.id()
                              + "' WHERE id='"
                              + p.id()
                              + "'";
                      case "created" ->
                          "UPDATE pattern SET created_at=clock_timestamp() WHERE id='"
                              + p.id()
                              + "'";
                      case "version-jump" ->
                          "UPDATE pattern SET"
                              + " status='ARCHIVED',version=50,updated_at=clock_timestamp() WHERE"
                              + " id='"
                              + p.id()
                              + "'";
                      case "same-status" ->
                          "UPDATE pattern SET version=1,updated_at=clock_timestamp() WHERE id='"
                              + p.id()
                              + "'";
                      case "revision-update" ->
                          "UPDATE pattern_revision SET measurement_revision_id='"
                              + m.latestRevision().id()
                              + "' WHERE pattern_id='"
                              + p.id()
                              + "'";
                      case "revision-delete" ->
                          "DELETE FROM pattern_revision WHERE pattern_id='" + p.id() + "'";
                      case "revision-truncate" -> "TRUNCATE pattern_revision";
                      case "pattern-delete" -> "DELETE FROM pattern WHERE id='" + p.id() + "'";
                      case "pattern-truncate" -> "TRUNCATE pattern CASCADE";
                      default -> {
                        q.execute(
                            "UPDATE pattern SET"
                                + " status='ARCHIVED',version=1,updated_at=clock_timestamp() WHERE"
                                + " id='"
                                + p.id()
                                + "'");
                        yield insert(p.id(), style.id(), 2, null);
                      }
                    };
                q.execute(sql);
                c.commit();
              })
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
    assertThat(patternCount("pattern_revision")).isEqualTo(1);
  }

  @Test
  void sameStylePinAndNullAreAcceptedWithoutJavaValidation() throws Exception {
    var m = create();
    var p = pattern();
    try (var c = connection();
        var q = c.createStatement()) {
      q.execute(insert(p.id(), style.id(), 2, m.latestRevision().id()));
      q.execute(insert(p.id(), style.id(), 3, null));
    }
    assertThat(patternCount("pattern_revision")).isEqualTo(3);
  }
}
