package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class PatternArtifactPersistenceTest extends PatternArtifactSupport {
  Connection connection() throws SQLException {
    return DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
  }

  UUID revision(Statement q, boolean expected, int n) throws SQLException {
    var r = id();
    q.execute(
        "INSERT INTO"
            + " pattern_revision(id,pattern_id,style_id,revision_number,name,created_by_issuer,created_by_subject,artifact_expected)"
            + " VALUES('"
            + r
            + "','"
            + family.id()
            + "','"
            + style.id()
            + "',"
            + n
            + ",'Snapshot','urn:synthetic','owner',"
            + expected
            + ")");
    return r;
  }

  UUID artifact(Statement q, UUID revision, Map<String, String> overrides) throws SQLException {
    var v = new LinkedHashMap<String, String>();
    UUID id = id();
    v.put("id", "'" + id + "'");
    v.put("pattern_revision_id", "'" + revision + "'");
    v.put("style_id", "'" + style.id() + "'");
    v.put("storage_object_id", "'" + id() + "'");
    v.put("declared_format", "'PDF'");
    v.put("display_name", "'safe.pdf'");
    v.put("size_bytes", "10");
    v.put("sha256", "'" + "a".repeat(64) + "'");
    v.put("probe_version", "1");
    v.put("state", "'PENDING'");
    v.put("failure_code", "null");
    v.put("version", "0");
    v.putAll(overrides);
    q.execute(
        "INSERT INTO pattern_artifact("
            + String.join(",", v.keySet())
            + ") VALUES("
            + String.join(",", v.values())
            + ")");
    return id;
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "expected-without-artifact",
        "false-with-artifact",
        "old-retrofit",
        "true-one",
        "false-zero"
      })
  void creationIntentAndCommitCompleteness(String kind) throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      if (kind.equals("true-one") || kind.equals("false-zero")) {
        var r = revision(q, kind.equals("true-one"), 2);
        if (kind.equals("true-one")) artifact(q, r, Map.of());
        c.commit();
      } else {
        assertThatThrownBy(
                () -> {
                  var r =
                      kind.equals("old-retrofit")
                          ? family.latestRevision().id()
                          : revision(q, kind.equals("expected-without-artifact"), 2);
                  if (!kind.equals("expected-without-artifact")) artifact(q, r, Map.of());
                  c.commit();
                })
            .isInstanceOf(SQLException.class);
        c.rollback();
      }
    }
    assertThat(patternCount("pattern_revision"))
        .isEqualTo(Set.of("true-one", "false-zero").contains(kind) ? 2 : 1);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "format",
        "size-zero",
        "size-large",
        "sha-uppercase",
        "sha-short",
        "sha-invalid",
        "name-dot",
        "name-dotdot",
        "name-leading",
        "name-trailing",
        "name-slash",
        "name-backslash",
        "name-control",
        "initial-ready",
        "initial-failed",
        "initial-version",
        "probe",
        "pending-failure",
        "foreign-style"
      })
  void invalidArtifactInsert(String kind) throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      assertThatThrownBy(
              () -> {
                var r = revision(q, true, 2);
                Map<String, String> m =
                    switch (kind) {
                      case "format" -> Map.of("declared_format", "'DXF'");
                      case "size-zero" -> Map.of("size_bytes", "0");
                      case "size-large" -> Map.of("size_bytes", "10485761");
                      case "sha-uppercase" -> Map.of("sha256", "'" + "A".repeat(64) + "'");
                      case "sha-short" -> Map.of("sha256", "'a'");
                      case "sha-invalid" -> Map.of("sha256", "'" + "g".repeat(64) + "'");
                      case "name-dot" -> Map.of("display_name", "'.'");
                      case "name-dotdot" -> Map.of("display_name", "'..'");
                      case "name-leading" -> Map.of("display_name", "' x'");
                      case "name-trailing" -> Map.of("display_name", "'x '");
                      case "name-slash" -> Map.of("display_name", "'x/y'");
                      case "name-backslash" -> Map.of("display_name", "'x\\y'");
                      case "name-control" -> Map.of("display_name", "E'x\\ny'");
                      case "initial-ready" -> Map.of("state", "'READY'");
                      case "initial-failed" ->
                          Map.of("state", "'FAILED'", "failure_code", "'STORAGE_WRITE_FAILED'");
                      case "initial-version" -> Map.of("version", "1");
                      case "probe" -> Map.of("probe_version", "2");
                      case "pending-failure" -> Map.of("failure_code", "'STORAGE_WRITE_FAILED'");
                      default -> Map.of("style_id", "'" + foreignStyle.id() + "'");
                    };
                artifact(q, r, m);
                c.commit();
              })
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "id",
        "pattern_revision_id",
        "style_id",
        "storage_object_id",
        "declared_format",
        "display_name",
        "size_bytes",
        "sha256",
        "probe_version",
        "created_at",
        "version-jump",
        "no-op",
        "failed-null",
        "ready-code",
        "failed-unknown",
        "delete",
        "truncate",
        "revision-update"
      })
  void immutableMetadataAndStateRelations(String kind) throws Exception {
    UUID a, r;
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      r = revision(q, true, 2);
      a = artifact(q, r, Map.of());
      c.commit();
      c.setAutoCommit(false);
      assertThatThrownBy(
              () -> {
                String change =
                    switch (kind) {
                      case "id", "pattern_revision_id", "style_id", "storage_object_id" ->
                          kind + "='" + id() + "'";
                      case "declared_format" -> "declared_format='DXF_AAMA'";
                      case "display_name" -> "display_name='changed.pdf'";
                      case "size_bytes" -> "size_bytes=11";
                      case "sha256" -> "sha256='" + "b".repeat(64) + "'";
                      case "probe_version" -> "probe_version=2";
                      case "created_at" -> "created_at=clock_timestamp()";
                      case "version-jump" -> "state='READY',version=3";
                      case "failed-null" -> "state='FAILED',version=1";
                      case "ready-code" ->
                          "state='READY',version=1,failure_code='STORAGE_WRITE_FAILED'";
                      case "failed-unknown" ->
                          "state='FAILED',version=1,failure_code='PRIVATE ERROR'";
                      default -> "state=state";
                    };
                String sql =
                    kind.equals("delete")
                        ? "DELETE FROM pattern_artifact WHERE id='" + a + "'"
                        : kind.equals("truncate")
                            ? "TRUNCATE pattern_artifact"
                            : kind.equals("revision-update")
                                ? "UPDATE pattern_revision SET artifact_expected=false WHERE id='"
                                    + r
                                    + "'"
                                : "UPDATE pattern_artifact SET "
                                    + change
                                    + ",updated_at=clock_timestamp()+interval '1 second' WHERE id='"
                                    + a
                                    + "'";
                q.execute(sql);
                c.commit();
              })
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"READY", "FAILED"})
  void terminalAndUniqueIdentities(String terminal) throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      var r = revision(q, true, 2);
      var object = id();
      var a = artifact(q, r, Map.of("storage_object_id", "'" + object + "'"));
      c.commit();
      q.execute(
          "UPDATE pattern_artifact SET state='"
              + terminal
              + "',version=1,updated_at=clock_timestamp()+interval '1 second',failure_code="
              + (terminal.equals("FAILED") ? "'STORAGE_WRITE_FAILED'" : "null")
              + " WHERE id='"
              + a
              + "'");
      c.commit();
      for (String s :
          List.of(
              "UPDATE pattern_artifact SET"
                  + " state='PENDING',version=2,failure_code=null,updated_at=clock_timestamp()+interval"
                  + " '2 second' WHERE id='"
                  + a
                  + "'",
              "UPDATE pattern_artifact SET state='"
                  + (terminal.equals("READY") ? "FAILED" : "READY")
                  + "',version=2,failure_code="
                  + (terminal.equals("READY") ? "'STORAGE_WRITE_FAILED'" : "null")
                  + ",updated_at=clock_timestamp()+interval '2 second' WHERE id='"
                  + a
                  + "'")) {
        assertThatThrownBy(() -> q.execute(s)).isInstanceOf(SQLException.class);
        c.rollback();
      }
      assertThatThrownBy(() -> artifact(q, r, Map.of())).isInstanceOf(SQLException.class);
      c.rollback();
      assertThatThrownBy(
              () -> {
                var next = revision(q, true, 3);
                artifact(q, next, Map.of("storage_object_id", "'" + object + "'"));
              })
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
  }
}
