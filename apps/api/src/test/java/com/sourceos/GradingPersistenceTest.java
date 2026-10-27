package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.grading.GradingText;
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
class GradingPersistenceTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  @BeforeAll
  static void migrate() {
    var f =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("21")
            .load();
    f.migrate();
    f.validate();
    assertThat(f.info().applied()).hasSize(21);
  }

  Connection connection() throws Exception {
    return DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
  }

  UUID style(Connection c) throws Exception {
    UUID o = UUID.randomUUID(), p = UUID.randomUUID(), s = UUID.randomUUID();
    try (var q = c.createStatement()) {
      q.execute("INSERT INTO organization(id,name) VALUES('" + o + "','Grading SQL fixture')");
      q.execute(
          "INSERT INTO project(id,organization_id,name) VALUES('" + p + "','" + o + "','Project')");
      q.execute("INSERT INTO style(id,project_id,name) VALUES('" + s + "','" + p + "','Style')");
    }
    return s;
  }

  record Draft(UUID aggregate, UUID revision) {}

  Draft construct(Connection c, String defect) throws Exception {
    UUID s = style(c), a = UUID.randomUUID(), r = UUID.randomUUID();
    c.setAutoCommit(false);
    try (var q = c.createStatement()) {
      q.execute(
          "INSERT INTO grade_rule_set(id,style_id,status,version) VALUES('"
              + a
              + "','"
              + s
              + "','"
              + (defect.equals("initial-status") ? "ARCHIVED" : "ACTIVE")
              + "',"
              + (defect.equals("initial-version") ? 1 : 0)
              + ")");
      if (defect.equals("empty")) return new Draft(a, r);
      q.execute(
          "INSERT INTO"
              + " grade_rule_set_revision(id,grade_rule_set_id,style_id,revision_number,name,base_size_code,unit_system,created_by_issuer,created_by_subject,sealed)"
              + " VALUES('"
              + r
              + "','"
              + a
              + "','"
              + s
              + "',"
              + (defect.equals("first-two") ? 2 : 1)
              + ",'"
              + (defect.equals("name-boundary") ? " invalid" : "Rules")
              + "','"
              + (defect.equals("missing-base") ? "OTHER" : "S0")
              + "','CM','urn:synthetic','writer',"
              + defect.equals("presealed")
              + ")");
      int sizes = defect.equals("one-size") ? 1 : defect.equals("31-sizes") ? 31 : 3;
      int rules = defect.equals("zero-rules") ? 0 : defect.equals("101-rules") ? 101 : 2;
      for (int i = 0; i < sizes; i++) {
        int position =
            defect.equals("size-gap") ? i + 1 : defect.equals("duplicate-size-position") ? 0 : i;
        q.execute(
            "INSERT INTO grade_size VALUES('"
                + r
                + "',"
                + position
                + ",'S"
                + (defect.equals("duplicate-size-code") ? 0 : i)
                + "','Size')");
      }
      for (int i = 0; i < rules; i++) {
        int position =
            defect.equals("rule-gap") ? i + 1 : defect.equals("duplicate-rule-position") ? 0 : i;
        q.execute(
            "INSERT INTO grade_rule VALUES('"
                + r
                + "',"
                + position
                + ",'R"
                + (defect.equals("duplicate-rule-code") ? 0 : i)
                + "','Rule',null)");
      }
      for (int i = 0; i < rules; i++)
        for (int j = 0; j < sizes; j++) {
          if (defect.equals("partial") && i == 0 && j == 0) continue;
          String delta =
              switch (defect) {
                case "nonzero-base" -> "1";
                case "null" -> "NULL";
                case "nan" -> "'NaN'";
                case "infinity" -> "'Infinity'";
                case "negative-infinity" -> "'-Infinity'";
                case "over-scale" -> j == 0 ? "0" : "1.23456";
                default -> j == 0 ? "0" : "-1.2500";
              };
          q.execute(
              "INSERT INTO grade_rule_value VALUES('"
                  + r
                  + "','"
                  + (defect.equals("unknown-rule") ? "OTHER" : "R" + i)
                  + "','"
                  + (defect.equals("unknown-size") ? "OTHER" : "S" + j)
                  + "',"
                  + delta
                  + ")");
        }
      if (defect.equals("duplicate-cell"))
        q.execute("INSERT INTO grade_rule_value VALUES('" + r + "','R0','S0',0)");
      if (!defect.equals("unsealed"))
        q.execute("UPDATE grade_rule_set_revision SET sealed=true WHERE id='" + r + "'");
    }
    return new Draft(a, r);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "initial-status",
        "initial-version",
        "empty",
        "first-two",
        "presealed",
        "name-boundary",
        "one-size",
        "31-sizes",
        "zero-rules",
        "101-rules",
        "size-gap",
        "rule-gap",
        "duplicate-size-code",
        "duplicate-size-position",
        "duplicate-rule-code",
        "duplicate-rule-position",
        "missing-base",
        "partial",
        "duplicate-cell",
        "unknown-rule",
        "unknown-size",
        "nonzero-base",
        "null",
        "nan",
        "infinity",
        "negative-infinity",
        "unsealed"
      })
  void directSqlCannotCommitInvalidSnapshots(String defect) throws Exception {
    try (var c = connection()) {
      assertThatThrownBy(
              () -> {
                construct(c, defect);
                c.commit();
              })
          .isInstanceOf(SQLException.class);
      c.rollback();
    }
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "DELETE FROM grade_rule_set",
        "TRUNCATE grade_rule_set",
        "DELETE FROM grade_rule_set_revision",
        "TRUNCATE grade_rule_set_revision",
        "UPDATE grade_size SET label='Other'",
        "DELETE FROM grade_size",
        "TRUNCATE grade_size",
        "UPDATE grade_rule SET label='Other'",
        "DELETE FROM grade_rule",
        "TRUNCATE grade_rule",
        "UPDATE grade_rule_value SET delta=0",
        "DELETE FROM grade_rule_value",
        "TRUNCATE grade_rule_value"
      })
  void statementDestructionGuards(String sql) throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      assertThatThrownBy(() -> q.execute(sql)).isInstanceOf(SQLException.class);
    }
  }

  @Test
  void deferredBaseFkAndSealedHistory() throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      var d = construct(c, "valid");
      q.execute("SET CONSTRAINTS ALL IMMEDIATE");
      c.commit();
      c.setAutoCommit(true);
      for (String sql :
          List.of(
              "UPDATE grade_rule_set_revision SET name='Other' WHERE id='" + d.revision() + "'",
              "UPDATE grade_rule_set_revision SET sealed=false WHERE id='" + d.revision() + "'",
              "UPDATE grade_rule_set_revision SET sealed=true WHERE id='" + d.revision() + "'",
              "INSERT INTO grade_size VALUES('" + d.revision() + "',3,'S3','Other')",
              "INSERT INTO grade_rule VALUES('" + d.revision() + "',2,'R2','Other',null)",
              "INSERT INTO grade_rule_value VALUES('" + d.revision() + "','R0','S0',0)",
              "UPDATE grade_rule_set SET status=status WHERE id='" + d.aggregate() + "'",
              "UPDATE grade_rule_set SET status='ARCHIVED',version=2,updated_at=clock_timestamp()"
                  + " WHERE id='"
                  + d.aggregate()
                  + "'"))
        assertThatThrownBy(() -> q.execute(sql)).as(sql).isInstanceOf(SQLException.class);
      var rs =
          q.executeQuery(
              "SELECT condeferrable,condeferred FROM pg_constraint WHERE"
                  + " conname='grade_revision_base_size_fk'");
      assertThat(rs.next()).isTrue();
      assertThat(rs.getBoolean(1)).isTrue();
      assertThat(rs.getBoolean(2)).isTrue();
      rs =
          q.executeQuery(
              "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND"
                  + " table_type='BASE TABLE'");
      rs.next();
      assertThat(rs.getInt(1)).isEqualTo(58);
    }
  }

  @Test
  void unicodeDifferentialBoundaryAndCodePointLength() throws Exception {
    try (var c = connection();
        var p = c.prepareStatement("SELECT grade_text_is_canonical(?,?)")) {
      try (var q = c.createStatement();
          var r =
              q.executeQuery(
                  "SELECT cp,grade_text_is_canonical(chr(cp)||'Value',160) FROM"
                      + " generate_series(1,65535) cp WHERE cp NOT BETWEEN 55296 AND 57343")) {
        int checked = 0;
        while (r.next()) {
          assertThat(r.getBoolean(2))
              .as("Unicode code point %s", r.getInt(1))
              .isEqualTo(!GradingText.boundary(r.getInt(1)));
          checked++;
        }
        assertThat(checked).isEqualTo(65535 - 2048);
      }
      var points = new ArrayList<Integer>();
      for (int cp = 0; cp <= 0xffff; cp++) if (GradingText.boundary(cp)) points.add(cp);
      for (int cp : points)
        for (String raw :
            List.of(
                new String(Character.toChars(cp)) + "Value",
                "Value" + new String(Character.toChars(cp)))) {
          p.setString(1, raw);
          p.setInt(2, 160);
          var r = p.executeQuery();
          r.next();
          assertThat(r.getBoolean(1)).isFalse();
          String canonical = GradingText.canonical(raw, 160, false);
          assertThat(canonical).isEqualTo("Value");
          p.setString(1, canonical);
          r = p.executeQuery();
          r.next();
          assertThat(r.getBoolean(1)).isTrue();
        }
      for (String value : List.of("🧵".repeat(160), "a\u0085b", "a\u00a0b", "a\ufeffb")) {
        assertThat(GradingText.canonical(value, 160, false)).isEqualTo(value);
        p.setString(1, value);
        p.setInt(2, 160);
        var r = p.executeQuery();
        r.next();
        assertThat(r.getBoolean(1)).isTrue();
      }
      assertThatThrownBy(() -> GradingText.canonical("🧵".repeat(161), 160, false))
          .hasMessageContaining("400");
      assertThat(GradingText.canonical("\u0085\ufeff", 1000, true)).isNull();
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"nan", "infinity", "negative-infinity"})
  void specialNumericEnforcementHasObservedPostgresqlState(String value) throws Exception {
    try (var c = connection()) {
      assertThatThrownBy(() -> construct(c, value))
          .isInstanceOfSatisfying(
              SQLException.class,
              e -> {
                assertThat(e.getSQLState()).isEqualTo(value.equals("nan") ? "23514" : "22003");
                System.out.println(
                    "GRADING_NUMERIC " + value + " rejected SQLSTATE=" + e.getSQLState());
              });
      c.rollback();
    }
  }

  @Test
  void baseFkIsActuallyDeferredAndRejectsWrongRevisionTarget() throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      var d = construct(c, "unsealed");
      q.execute("SET CONSTRAINTS grade_revision_base_size_fk IMMEDIATE");
      c.rollback();
      c.setAutoCommit(true);
      var other = construct(c, "valid");
      c.commit();
      c.setAutoCommit(true);
      UUID a = UUID.randomUUID(), r = UUID.randomUUID(), s = style(c);
      c.setAutoCommit(false);
      q.execute("INSERT INTO grade_rule_set(id,style_id) VALUES('" + a + "','" + s + "')");
      q.execute(
          "INSERT INTO"
              + " grade_rule_set_revision(id,grade_rule_set_id,style_id,revision_number,name,base_size_code,unit_system,created_by_issuer,created_by_subject)"
              + " VALUES('"
              + r
              + "','"
              + a
              + "','"
              + s
              + "',1,'Rules','S0','CM','urn:synthetic','writer')");
      assertThatThrownBy(() -> q.execute("SET CONSTRAINTS grade_revision_base_size_fk IMMEDIATE"))
          .isInstanceOfSatisfying(
              SQLException.class, e -> assertThat(e.getSQLState()).isEqualTo("23503"));
      c.rollback();
      construct(c, "partial");
      assertThatThrownBy(() -> q.execute("SET CONSTRAINTS ALL IMMEDIATE"))
          .isInstanceOfSatisfying(
              SQLException.class, e -> assertThat(e.getSQLState()).isEqualTo("P0001"));
      c.rollback();
    }
  }

  @Test
  void sameRevisionFksCannotUseOtherRevisionsChildren() throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      var a = construct(c, "unsealed");
      var b = construct(c, "unsealed");
      q.execute("INSERT INTO grade_rule VALUES('" + b.revision() + "',2,'OTHER','Other',null)");
      assertThatThrownBy(
              () ->
                  q.execute(
                      "INSERT INTO grade_rule_value VALUES('" + a.revision() + "','OTHER','S0',0)"))
          .isInstanceOfSatisfying(
              SQLException.class, e -> assertThat(e.getSQLState()).isEqualTo("23503"));
      c.rollback();
    }
  }

  @Test
  void maximumSnapshotConstructionCommitScanCountAndPlans() throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      UUID s = style(c), a = UUID.randomUUID(), r = UUID.randomUUID();
      q.execute("SET track_functions='pl'");
      q.execute(
          "SELECT"
              + " pg_stat_reset_single_function_counters('require_grade_revision_complete'::regproc)");
      c.setAutoCommit(false);
      int statements = 0;
      q.execute("INSERT INTO grade_rule_set(id,style_id) VALUES('" + a + "','" + s + "')");
      statements++;
      q.execute(
          "INSERT INTO"
              + " grade_rule_set_revision(id,grade_rule_set_id,style_id,revision_number,name,base_size_code,unit_system,created_by_issuer,created_by_subject)"
              + " VALUES('"
              + r
              + "','"
              + a
              + "','"
              + s
              + "',1,'Maximum','S5','CM','urn:synthetic','writer')");
      statements++;
      q.execute(
          "INSERT INTO grade_size SELECT '"
              + r
              + "'::uuid,i,'S'||i,'Size '||i FROM generate_series(0,29) i");
      statements++;
      q.execute(
          "INSERT INTO grade_rule SELECT '"
              + r
              + "'::uuid,i,'R'||i,'Rule '||i,null FROM generate_series(0,99) i");
      statements++;
      long start = System.nanoTime();
      q.execute(
          "INSERT INTO grade_rule_value SELECT '"
              + r
              + "'::uuid,g.code,s.code,CASE WHEN s.code='S5' THEN 0::numeric ELSE"
              + " '-2.1250'::numeric END FROM grade_rule g CROSS JOIN grade_size s WHERE"
              + " g.revision_id='"
              + r
              + "' AND s.revision_id='"
              + r
              + "'");
      statements++;
      long insert = System.nanoTime() - start;
      start = System.nanoTime();
      q.execute("UPDATE grade_rule_set_revision SET sealed=true WHERE id='" + r + "'");
      statements++;
      long seal = System.nanoTime() - start;
      start = System.nanoTime();
      c.commit();
      long commit = System.nanoTime() - start;
      c.setAutoCommit(true);
      q.execute("SELECT pg_stat_force_next_flush()");
      long calls;
      double completeness;
      try (var count =
          q.executeQuery(
              "SELECT calls,total_time FROM pg_stat_user_functions WHERE"
                  + " funcid='require_grade_revision_complete'::regproc")) {
        assertThat(count.next()).isTrue();
        calls = count.getLong(1);
        completeness = count.getDouble(2);
      }
      assertThat(calls).isEqualTo(1);
      assertThat(statements).isEqualTo(6);
      start = System.nanoTime();
      for (String sql :
          List.of(
              "SELECT * FROM grade_rule_set_revision WHERE id='" + r + "'",
              "SELECT * FROM grade_size WHERE revision_id='" + r + "' ORDER BY position",
              "SELECT * FROM grade_rule WHERE revision_id='" + r + "' ORDER BY position",
              "SELECT v.*,g.position,s.position FROM grade_rule_value v JOIN grade_rule g ON"
                  + " g.revision_id=v.revision_id AND g.code=v.rule_code JOIN grade_size s ON"
                  + " s.revision_id=v.revision_id AND s.code=v.size_code WHERE v.revision_id='"
                  + r
                  + "' ORDER BY g.position,s.position")) {
        int count = 0;
        try (var rows = q.executeQuery(sql)) {
          while (rows.next()) count++;
        }
        assertThat(count)
            .isEqualTo(
                sql.contains("SELECT v.*")
                    ? 3000
                    : sql.contains("FROM grade_size")
                        ? 30
                        : sql.contains("FROM grade_rule WHERE") ? 100 : 1);
      }
      long read = System.nanoTime() - start;
      System.out.printf(
          "GRADING_MAX_SQL valuesInsertMs=%.3f sealUpdateMs=%.3f commitMs=%.3f"
              + " deferredCompletenessMs=%.3f exactReadMs=%.3f constructionStatements=%d"
              + " exactReadStatements=4 completenessCalls=%d%n",
          insert / 1e6, seal / 1e6, commit / 1e6, completeness, read / 1e6, statements, calls);
      for (String sql :
          List.of(
              "SELECT p.*,r.id FROM grade_rule_set p LEFT JOIN LATERAL (SELECT id FROM"
                  + " grade_rule_set_revision WHERE grade_rule_set_id=p.id ORDER BY revision_number"
                  + " DESC LIMIT 1) r ON true WHERE p.style_id='"
                  + s
                  + "' AND p.status='ACTIVE' ORDER BY p.created_at DESC,p.id DESC LIMIT 25",
              "SELECT * FROM grade_rule_set_revision WHERE grade_rule_set_id='"
                  + a
                  + "' AND revision_number<=1 ORDER BY revision_number DESC LIMIT 26"))
        try (var plan = q.executeQuery("EXPLAIN (ANALYZE,BUFFERS) " + sql)) {
          while (plan.next()) System.out.println("GRADING_PLAN " + plan.getString(1));
        }
    }
  }

  UUID copyRevision(Connection c, Draft d, int number) throws Exception {
    UUID revision = UUID.randomUUID();
    try (var q = c.createStatement()) {
      q.execute(
          "INSERT INTO"
              + " grade_rule_set_revision(id,grade_rule_set_id,style_id,revision_number,name,base_size_code,unit_system,created_by_issuer,created_by_subject)"
              + " SELECT '"
              + revision
              + "'::uuid,grade_rule_set_id,style_id,"
              + number
              + ",name,base_size_code,unit_system,created_by_issuer,created_by_subject FROM"
              + " grade_rule_set_revision WHERE id='"
              + d.revision()
              + "'");
      q.execute(
          "INSERT INTO grade_size SELECT '"
              + revision
              + "'::uuid,position,code,label FROM grade_size WHERE revision_id='"
              + d.revision()
              + "'");
      q.execute(
          "INSERT INTO grade_rule SELECT '"
              + revision
              + "'::uuid,position,code,label,notes FROM grade_rule WHERE revision_id='"
              + d.revision()
              + "'");
      q.execute(
          "INSERT INTO grade_rule_value SELECT '"
              + revision
              + "'::uuid,rule_code,size_code,delta FROM grade_rule_value WHERE revision_id='"
              + d.revision()
              + "'");
      q.execute("UPDATE grade_rule_set_revision SET sealed=true WHERE id='" + revision + "'");
    }
    return revision;
  }

  @Test
  void directSqlTypmodCoercionIsDistinctFromApiOverScaleRejection() throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      var d = construct(c, "over-scale");
      c.commit();
      var r =
          q.executeQuery(
              "SELECT delta FROM grade_rule_value WHERE revision_id='"
                  + d.revision()
                  + "' AND size_code='S1'");
      assertThat(r.next()).isTrue();
      assertThat(r.getBigDecimal(1).toPlainString()).isEqualTo("1.2346");
      System.out.println(
          "GRADING_NUMERIC direct SQL 1.23456 stored as 1.2346 by NUMERIC(19,4) typmod");
    }
  }

  @Test
  void directSequenceSerializesOnOwningAggregateAndRejectsStaleNumber() throws Exception {
    try (var c = connection();
        var q = c.createStatement()) {
      var d = construct(c, "valid");
      c.commit();
      copyRevision(c, d, 2);
      var waiter = new CompletableFuture<Integer>();
      var executor = Executors.newSingleThreadExecutor();
      try {
        var second =
            executor.submit(
                () -> {
                  try (var other = connection();
                      var sql = other.createStatement()) {
                    other.setAutoCommit(false);
                    sql.execute("SET LOCAL lock_timeout='6s'");
                    var pid = sql.executeQuery("SELECT pg_backend_pid()");
                    pid.next();
                    waiter.complete(pid.getInt(1));
                    try {
                      copyRevision(other, d, 2);
                      other.commit();
                      return "unexpected success";
                    } catch (SQLException expected) {
                      other.rollback();
                      return expected.getSQLState();
                    }
                  }
                });
        int pid = waiter.get(3, TimeUnit.SECONDS);
        boolean blocked = false;
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
        while (System.nanoTime() < end) {
          try (var state = q.executeQuery("SELECT cardinality(pg_blocking_pids(" + pid + "))>0")) {
            state.next();
            if (state.getBoolean(1)) {
              blocked = true;
              break;
            }
          }
          Thread.onSpinWait();
        }
        assertThat(blocked).as("actual direct-SQL sequence waiter").isTrue();
        c.commit();
        assertThat(second.get(10, TimeUnit.SECONDS)).isEqualTo("P0001");
        var count =
            q.executeQuery(
                "SELECT count(*),max(revision_number) FROM grade_rule_set_revision WHERE"
                    + " grade_rule_set_id='"
                    + d.aggregate()
                    + "'");
        count.next();
        assertThat(count.getInt(1)).isEqualTo(2);
        assertThat(count.getInt(2)).isEqualTo(2);
        c.rollback();
      } finally {
        c.rollback();
        executor.shutdownNow();
        assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
      }
    }
  }
}
