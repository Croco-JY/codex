package com.sourceos;

import static com.sourceos.PatternReleaseSqlFixture.*;
import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import java.util.stream.Stream;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class PatternReleaseDatabaseTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  @BeforeAll
  static void migrate() {
    var f =
        Flyway.configure().dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword()).load();
    f.migrate();
    f.validate();
    assertThat(f.info().applied()).hasSize(23);
  }

  Connection connection() throws SQLException {
    var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
    c.setAutoCommit(false);
    return c;
  }

  @Test
  void validImmutableHistoryAndFreshInventory() throws Exception {
    try (var c = connection()) {
      var f = seed(c, "READY");
      var consent = consent(c, f);
      c.commit();
      var release = release(c, f, consent);
      c.commit();
      consentEvent(c, f, consent, 3, "WITHDRAWN", null);
      releaseEvent(c, f, release, 2, "REVOKED");
      c.commit();
      assertThat(
              count(
                  c,
                  "SELECT count(*) FROM pattern_release_consent_event WHERE consent_id="
                      + q(consent)))
          .isEqualTo(3);
      assertThat(
              count(c, "SELECT count(*) FROM pattern_release_event WHERE release_id=" + q(release)))
          .isEqualTo(2);
      assertThat(
              count(
                  c,
                  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND"
                      + " table_type='BASE TABLE'"))
          .isEqualTo(63);
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"PENDING", "FAILED", "NONE"})
  void onlyExactReadyArtifactIsReleasable(String state) throws Exception {
    try (var c = connection()) {
      var f = seed(c, state);
      var consent = consent(c, f);
      c.commit();
      assertThatThrownBy(() -> release(c, f, consent)).isInstanceOf(SQLException.class);
      c.rollback();
      assertThat(count(c, "SELECT count(*) FROM pattern_release WHERE consent_id=" + q(consent)))
          .isZero();
    }
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "project_id",
        "style_id",
        "pattern_id",
        "pattern_revision_id",
        "artifact_id",
        "storage_object_id",
        "consent_id",
        "recipient_organization_id"
      })
  void forgedOwnershipOrBindingFails(String column) throws Exception {
    try (var c = connection()) {
      var f = seed(c, "READY");
      var consent = consent(c, f);
      c.commit();
      assertThatThrownBy(
              () ->
                  sql(
                      c,
                      releaseSql(
                          f, consent, UUID.randomUUID(), Map.of(column, q(UUID.randomUUID())))))
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
  }

  static Stream<Arguments> invalidValues() {
    return Stream.of(
        Arguments.of("sha256", "repeat('b',64)"),
        Arguments.of("size_bytes", "4"),
        Arguments.of("display_name", "'Other.pdf'"),
        Arguments.of("declared_format", "'DXF_AAMA'"),
        Arguments.of("pattern_revision_number", "2"),
        Arguments.of("access_duration_seconds", "0"),
        Arguments.of("access_duration_seconds", "86401"),
        Arguments.of("purpose", "' bad'"),
        Arguments.of("purpose", "''"),
        Arguments.of("purpose", "null"),
        Arguments.of("purpose", "repeat('x',1001)"),
        Arguments.of("source_version", "1"),
        Arguments.of("recipient_version", "1"),
        Arguments.of("project_version", "1"),
        Arguments.of("style_version", "1"),
        Arguments.of("pattern_version", "1"));
  }

  @ParameterizedTest
  @MethodSource("invalidValues")
  void invalidTupleTextBoundsOrVersionFails(String col, String value) throws Exception {
    try (var c = connection()) {
      var f = seed(c, "READY");
      var consent = consent(c, f);
      c.commit();
      assertThatThrownBy(
              () -> sql(c, releaseSql(f, consent, UUID.randomUUID(), Map.of(col, value))))
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
  }

  @Test
  void foreignReadyArtifactAndSameOrganizationFail() throws Exception {
    try (var c = connection()) {
      var f = seed(c, "READY");
      var other = seed(c, "READY");
      var consent = consent(c, f);
      c.commit();
      assertThatThrownBy(
              () ->
                  sql(
                      c,
                      releaseSql(
                          f,
                          consent,
                          UUID.randomUUID(),
                          Map.of(
                              "artifact_id",
                              q(other.artifact()),
                              "storage_object_id",
                              q(other.object())))))
          .isInstanceOf(SQLException.class);
      c.rollback();
      assertThatThrownBy(
              () ->
                  sql(
                      c,
                      "INSERT INTO"
                          + " pattern_release_consent(id,recipient_organization_id,intended_source_organization_id,issuer,subject)"
                          + " VALUES(gen_random_uuid(),"
                          + q(f.source())
                          + ","
                          + q(f.source())
                          + ",'issuer','subject')"))
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
  }

  @Test
  void unknownSourceIsOpaqueAndTimesAreDatabaseOwned() throws Exception {
    try (var c = connection()) {
      var f = seed(c, "READY");
      UUID consent = UUID.randomUUID();
      sql(
          c,
          "INSERT INTO"
              + " pattern_release_consent(id,recipient_organization_id,intended_source_organization_id,issuer,subject,issued_at,expires_at)"
              + " VALUES("
              + q(consent)
              + ","
              + q(f.recipient())
              + ",gen_random_uuid(),"
              + q(ISSUER)
              + ",'recipient','2100-01-01','2200-01-01')");
      consentEvent(c, f, consent, 1, "ISSUED", null);
      c.commit();
      assertThat(
              count(
                  c,
                  "SELECT count(*) FROM pattern_release_consent WHERE id="
                      + q(consent)
                      + " AND issued_at<clock_timestamp() AND expires_at=issued_at+interval '15"
                      + " minutes' AND expires_at<clock_timestamp()+interval '15 minutes'"))
          .isEqualTo(1);
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"consent", "activation", "consumption"})
  void incompleteConstructionCannotCommit(String missing) throws Exception {
    try (var c = connection()) {
      var f = seed(c, "READY");
      UUID consent = UUID.randomUUID(), release = UUID.randomUUID();
      c.commit();
      assertThatThrownBy(
              () -> {
                if (missing.equals("consent")) {
                  sql(
                      c,
                      "INSERT INTO"
                          + " pattern_release_consent(id,recipient_organization_id,intended_source_organization_id,issuer,subject)"
                          + " VALUES("
                          + q(consent)
                          + ","
                          + q(f.recipient())
                          + ","
                          + q(f.source())
                          + ","
                          + q(ISSUER)
                          + ",'recipient')");
                } else {
                  UUID actual = consent(c, f);
                  sql(c, releaseSql(f, actual, release, Map.of()));
                  if (!missing.equals("activation")) releaseEvent(c, f, release, 1, "ACTIVATED");
                  if (!missing.equals("consumption"))
                    consentEvent(c, f, actual, 2, "CONSUMED", release);
                }
                c.commit();
              })
          .isInstanceOf(SQLException.class);
      c.rollback();
      assertThat(count(c, "SELECT count(*) FROM pattern_release WHERE id=" + q(release))).isZero();
    }
  }

  @Test
  void singleConsumptionAndIrreversibleEventSequences() throws Exception {
    try (var c = connection()) {
      var f = seed(c, "READY");
      var consent = consent(c, f);
      c.commit();
      var release = release(c, f, consent);
      c.commit();
      assertThatThrownBy(() -> release(c, f, consent)).isInstanceOf(SQLException.class);
      c.rollback();
      consentEvent(c, f, consent, 3, "WITHDRAWN", null);
      c.commit();
      assertThatThrownBy(() -> consentEvent(c, f, consent, 4, "CONSUMED", release))
          .isInstanceOf(SQLException.class);
      c.rollback();
      releaseEvent(c, f, release, 2, "REVOKED");
      c.commit();
      assertThatThrownBy(() -> releaseEvent(c, f, release, 3, "ACTIVATED"))
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
  }

  static Stream<Arguments> destruction() {
    return Stream.of(
            "pattern_release_consent",
            "pattern_release_consent_event",
            "pattern_release",
            "pattern_release_event")
        .flatMap(t -> Stream.of("UPDATE", "DELETE", "TRUNCATE").map(op -> Arguments.of(t, op)));
  }

  @ParameterizedTest
  @MethodSource("destruction")
  void immutableEvenEmptyTargetAndCascade(String table, String op) throws Exception {
    try (var c = connection()) {
      String s =
          switch (op) {
            case "UPDATE" -> "UPDATE " + table + " SET id=id WHERE false";
            case "DELETE" -> "DELETE FROM " + table + " WHERE false";
            default -> "TRUNCATE " + table + " CASCADE";
          };
      assertThatThrownBy(() -> sql(c, s))
          .isInstanceOf(SQLException.class)
          .hasMessageContaining("cannot be deleted or truncated");
      c.rollback();
    }
  }

  static Stream<Arguments> versions() {
    return Stream.of("organization", "project", "style")
        .flatMap(t -> Stream.of("version", "-1", "2", "null").map(v -> Arguments.of(t, v)));
  }

  @ParameterizedTest
  @MethodSource("versions")
  void parentVersionNoAdvanceRewindJumpAndNullFail(String table, String value) throws Exception {
    try (var c = connection()) {
      var f = seed(c, "READY");
      c.commit();
      UUID id =
          table.equals("organization")
              ? f.source()
              : table.equals("project") ? f.project() : f.style();
      assertThatThrownBy(
              () -> sql(c, "UPDATE " + table + " SET version=" + value + " WHERE id=" + q(id)))
          .isInstanceOf(SQLException.class);
      c.rollback();
      sql(c, "UPDATE " + table + " SET version=version+1 WHERE id=" + q(id));
      c.commit();
      assertThat(count(c, "SELECT version FROM " + table + " WHERE id=" + q(id))).isEqualTo(1);
    }
  }

  @Test
  void versionOverflowRejectedBeforeArithmeticAndArchiveDeniesRelease() throws Exception {
    try (var c = connection()) {
      var f = seed(c, "READY");
      var consent = consent(c, f);
      UUID terminal = UUID.randomUUID();
      sql(
          c,
          "INSERT INTO organization(id,name,version) VALUES("
              + q(terminal)
              + ",'Terminal',9223372036854775807)");
      c.commit();
      assertThatThrownBy(
              () -> sql(c, "UPDATE organization SET name='Changed' WHERE id=" + q(terminal)))
          .isInstanceOf(SQLException.class)
          .hasMessageContaining("exhausted");
      c.rollback();
      sql(c, "UPDATE project SET status='ARCHIVED',version=version+1 WHERE id=" + q(f.project()));
      c.commit();
      assertThatThrownBy(() -> release(c, f, consent)).isInstanceOf(SQLException.class);
      c.rollback();
    }
  }
}
