package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.patternqa.QaText;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class PatternQaPersistenceTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  @BeforeAll
  static void migrate() {
    var f =
        Flyway.configure().dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword()).load();
    f.migrate();
    f.validate();
    assertThat(f.info().applied()).hasSize(22);
  }

  Connection connection() throws Exception {
    return DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
  }

  record Fixture(UUID style, UUID pattern, UUID revision, UUID artifact) {}

  Fixture seed(Connection c, String state) throws Exception {
    UUID o = UUID.randomUUID(),
        p = UUID.randomUUID(),
        s = UUID.randomUUID(),
        pattern = UUID.randomUUID(),
        r = UUID.randomUUID(),
        a = state == null ? null : UUID.randomUUID();
    c.setAutoCommit(false);
    try (var q = c.createStatement()) {
      q.execute("INSERT INTO organization(id,name) VALUES('" + o + "','QA SQL fixture')");
      q.execute(
          "INSERT INTO project(id,organization_id,name) VALUES('" + p + "','" + o + "','Project')");
      q.execute("INSERT INTO style(id,project_id,name) VALUES('" + s + "','" + p + "','Style')");
      q.execute("INSERT INTO pattern(id,style_id) VALUES('" + pattern + "','" + s + "')");
      q.execute(
          "INSERT INTO"
              + " pattern_revision(id,pattern_id,style_id,revision_number,name,created_by_issuer,created_by_subject,artifact_expected)"
              + " VALUES('"
              + r
              + "','"
              + pattern
              + "','"
              + s
              + "',1,'Revision','urn:qa','reviewer',"
              + (a != null)
              + ")");
      if (a != null) {
        q.execute(
            "INSERT INTO"
                + " pattern_artifact(id,pattern_revision_id,style_id,storage_object_id,declared_format,display_name,size_bytes,sha256,state)"
                + " VALUES('"
                + a
                + "','"
                + r
                + "','"
                + s
                + "',gen_random_uuid(),'PDF','artifact.pdf',1,'"
                + "a".repeat(64)
                + "','PENDING')");
        if (!state.equals("PENDING"))
          q.execute(
              "UPDATE pattern_artifact SET state='"
                  + state
                  + "',version=1,updated_at=clock_timestamp()+interval '1"
                  + " microsecond',failure_code="
                  + (state.equals("FAILED") ? "'STORAGE_WRITE_FAILED'" : "NULL")
                  + " WHERE id='"
                  + a
                  + "'");
      }
    }
    c.commit();
    return new Fixture(s, pattern, r, a);
  }

  UUID insert(
      Connection c,
      Fixture f,
      long number,
      String outcome,
      String basis,
      UUID artifact,
      String notes)
      throws Exception {
    UUID id = UUID.randomUUID();
    try (var q =
        c.prepareStatement(
            "INSERT INTO"
                + " pattern_qa_assessment(id,pattern_revision_id,style_id,assessment_number,outcome,evidence_basis,artifact_id,notes,reviewer_issuer,reviewer_subject)"
                + " VALUES(?,?,?,?,?,?,?,?,?,?)")) {
      q.setObject(1, id);
      q.setObject(2, f.revision());
      q.setObject(3, f.style());
      q.setLong(4, number);
      q.setString(5, outcome);
      q.setString(6, basis);
      q.setObject(7, artifact);
      q.setString(8, notes);
      q.setString(9, "urn:qa");
      q.setString(10, "reviewer");
      q.executeUpdate();
    }
    return id;
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "missing-revision",
        "foreign-style",
        "wrong-artifact",
        "pending",
        "failed",
        "human-metadata",
        "metadata-artifact",
        "ready-null",
        "missing-artifact",
        "notes-null",
        "notes-empty",
        "notes-leading",
        "notes-trailing",
        "notes-long",
        "outcome",
        "basis",
        "first-two",
        "negative",
        "overflow",
        "archived",
        "gap",
        "duplicate"
      })
  void productionSchemaRejectsInvalidAssessment(String kind) throws Exception {
    try (var c = connection()) {
      String state =
          Set.of("pending", "failed", "wrong-artifact", "metadata-artifact").contains(kind)
              ? (kind.equals("pending") ? "PENDING" : kind.equals("failed") ? "FAILED" : "READY")
              : null;
      var f = seed(c, state);
      UUID artifact = null;
      String outcome = "OBSERVED", basis = "METADATA_ONLY", notes = "Human notes";
      long number = 1;
      if (kind.equals("missing-revision"))
        f = new Fixture(f.style(), f.pattern(), UUID.randomUUID(), null);
      if (kind.equals("foreign-style"))
        f = new Fixture(UUID.randomUUID(), f.pattern(), f.revision(), null);
      if (Set.of("pending", "failed", "wrong-artifact", "metadata-artifact").contains(kind)) {
        artifact = f.artifact();
        basis = "READY_ARTIFACT";
      }
      if (kind.equals("wrong-artifact")) {
        var other = seed(c, null);
        f = other;
      }
      if (kind.equals("metadata-artifact")) basis = "METADATA_ONLY";
      if (kind.equals("human-metadata")) outcome = "HUMAN_REVIEWED";
      if (kind.equals("ready-null")) basis = "READY_ARTIFACT";
      if (kind.equals("missing-artifact")) {
        basis = "READY_ARTIFACT";
        artifact = UUID.randomUUID();
      }
      if (kind.equals("notes-null")) notes = null;
      if (kind.equals("notes-empty")) notes = "";
      if (kind.equals("notes-leading")) notes = "\ufeffnot canonical";
      if (kind.equals("notes-trailing")) notes = "not canonical\u0085";
      if (kind.equals("notes-long")) notes = "🧵".repeat(2001);
      if (kind.equals("outcome")) outcome = "PRODUCTION_VERIFIED";
      if (kind.equals("basis")) basis = "BINARY_UPLOADED";
      if (kind.equals("first-two")) number = 2;
      if (kind.equals("negative")) number = -1;
      if (kind.equals("overflow")) number = 9007199254740992L;
      if (kind.equals("archived"))
        try (var q = c.createStatement()) {
          q.execute(
              "UPDATE pattern SET status='ARCHIVED',version=1,updated_at=clock_timestamp()+interval"
                  + " '1 microsecond' WHERE id='"
                  + f.pattern()
                  + "'");
          c.commit();
        }
      if (Set.of("gap", "duplicate").contains(kind)) {
        insert(c, f, 1, "OBSERVED", "METADATA_ONLY", null, "First");
        c.commit();
        number = kind.equals("gap") ? 3 : 1;
      }
      var target = f;
      long n = number;
      String o = outcome, b = basis, t = notes;
      UUID a = artifact;
      assertThatThrownBy(
              () -> {
                insert(c, target, n, o, b, a, t);
                c.commit();
              })
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "UPDATE pattern_qa_assessment SET notes='rewrite'",
        "DELETE FROM pattern_qa_assessment",
        "TRUNCATE pattern_qa_assessment",
        "TRUNCATE pattern_qa_assessment CASCADE"
      })
  void statementDestructionGuardsRejectEvenEmptyTargets(String sql) throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      assertThatThrownBy(() -> q.execute(sql))
          .isInstanceOf(SQLException.class)
          .hasMessageContaining("Workspace rows cannot be deleted or truncated");
      c.rollback();
      var f = seed(c, null);
      insert(c, f, 1, "OBSERVED", "METADATA_ONLY", null, "Preserved");
      c.commit();
      assertThatThrownBy(() -> q.execute(sql)).isInstanceOf(SQLException.class);
      c.rollback();
    }
  }

  @Test
  void freshInventoryKeysAndValidImmutableRecords() throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      var f = seed(c, null);
      var first = insert(c, f, 1, "OBSERVED", "METADATA_ONLY", null, "Metadata only 🧵");
      c.commit();
      insert(c, f, 2, "CHANGES_REQUESTED", "METADATA_ONLY", null, "Requested changes");
      c.commit();
      var ready = seed(c, "READY");
      insert(
          c,
          ready,
          1,
          "HUMAN_REVIEWED",
          "READY_ARTIFACT",
          ready.artifact(),
          "Exact READY human attestation");
      c.commit();
      try (var r =
          q.executeQuery(
              "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND"
                  + " table_type='BASE TABLE'")) {
        r.next();
        assertThat(r.getInt(1)).isEqualTo(59);
      }
      try (var r =
          q.executeQuery("SELECT notes FROM pattern_qa_assessment WHERE id='" + first + "'")) {
        r.next();
        assertThat(r.getString(1)).isEqualTo("Metadata only 🧵");
      }
      try (var r =
          q.executeQuery(
              "SELECT count(*) FROM pg_indexes WHERE tablename='pattern_qa_assessment'")) {
        r.next();
        assertThat(r.getInt(1)).isEqualTo(2);
      }
      try (var r =
          q.executeQuery(
              "SELECT count(*) FROM pg_trigger WHERE tgrelid='pattern_qa_assessment'::regclass AND"
                  + " NOT tgisinternal AND tgenabled='O'")) {
        r.next();
        assertThat(r.getInt(1)).isEqualTo(4);
      }
    }
  }

  @Test
  void fixedUnicodeBoundaryMatchesPostgresCodePointPolicy() throws Exception {
    try (var c = connection();
        var p = c.prepareStatement("SELECT pattern_qa_text_is_canonical(?)")) {
      for (int cp = 1; cp <= 0xffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        String edge = new String(Character.toChars(cp)), value = edge + "Note" + edge;
        p.setString(1, value);
        try (var r = p.executeQuery()) {
          r.next();
          assertThat(r.getBoolean(1)).as("U+%04X", cp).isEqualTo(!QaText.boundary(cp));
        }
        assertThat(QaText.notes(value)).isEqualTo(QaText.boundary(cp) ? "Note" : value);
      }
      assertThat(QaText.notes("🧵".repeat(2000))).hasSize(4000);
      assertThatThrownBy(() -> QaText.notes("🧵".repeat(2001))).hasMessageContaining("400");
      p.setString(1, "🧵".repeat(2000));
      try (var r = p.executeQuery()) {
        r.next();
        assertThat(r.getBoolean(1)).isTrue();
      }
    }
  }

  @Test
  void directSqlSequenceUsesOwningPatternLockAcrossConnections() throws Exception {
    try (var first = connection();
        var second = connection();
        var observer = connection()) {
      var f = seed(first, null);
      second.setAutoCommit(false);
      insert(first, f, 1, "OBSERVED", "METADATA_ONLY", null, "Winner");
      int pid;
      try (var s = second.createStatement();
          var rs = s.executeQuery("SELECT pg_backend_pid()")) {
        rs.next();
        pid = rs.getInt(1);
      }
      var entered = new CountDownLatch(1);
      var pool = Executors.newSingleThreadExecutor();
      try {
        var loser =
            pool.submit(
                () -> {
                  entered.countDown();
                  try {
                    insert(second, f, 1, "OBSERVED", "METADATA_ONLY", null, "Stale SQL");
                    second.commit();
                    return "unexpected success";
                  } catch (SQLException e) {
                    second.rollback();
                    return e.getSQLState();
                  }
                });
        assertThat(entered.await(3, TimeUnit.SECONDS)).isTrue();
        boolean blocked = false;
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
        while (System.nanoTime() < end) {
          try (var s = observer.createStatement();
              var rs = s.executeQuery("SELECT cardinality(pg_blocking_pids(" + pid + "))>0")) {
            rs.next();
            blocked = rs.getBoolean(1);
          }
          if (blocked) break;
          Thread.onSpinWait();
        }
        assertThat(blocked).as("direct SQL sequence waits for owning Pattern").isTrue();
        first.commit();
        assertThat(loser.get(6, TimeUnit.SECONDS)).isEqualTo("P0001");
        try (var s = observer.createStatement();
            var rs =
                s.executeQuery(
                    "SELECT count(*) FROM pattern_qa_assessment WHERE pattern_revision_id='"
                        + f.revision()
                        + "'")) {
          rs.next();
          assertThat(rs.getInt(1)).isEqualTo(1);
        }
      } finally {
        first.rollback();
        pool.shutdownNow();
        assertThat(pool.awaitTermination(6, TimeUnit.SECONDS)).isTrue();
      }
    }
  }
}
