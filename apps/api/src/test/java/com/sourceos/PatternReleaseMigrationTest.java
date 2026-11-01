package com.sourceos;

import static com.sourceos.PatternReleaseSqlFixture.*;
import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class PatternReleaseMigrationTest {
  @Container static PostgreSQLContainer db = new PostgreSQLContainer("postgres:18.3");

  @Test
  void populatedV22UpgradePreservesAll58PriorTablesAndTriggers() throws Exception {
    var old =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("22")
            .load();
    old.migrate();
    old.validate();
    var snapshot = new PatternQaMigrationTest();
    Map<String, List<String>> before;
    List<String> triggers;
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword())) {
      c.setAutoCommit(false);
      var ready = seed(c, "READY");
      seed(c, "PENDING");
      seed(c, "FAILED");
      var artifactless = seed(c, "NONE");
      sql(
          c,
          "INSERT INTO"
              + " pattern_qa_assessment(id,pattern_revision_id,style_id,assessment_number,outcome,evidence_basis,notes,reviewer_issuer,reviewer_subject)"
              + " VALUES(gen_random_uuid(),"
              + q(artifactless.revision())
              + ","
              + q(artifactless.style())
              + ",1,'OBSERVED','METADATA_ONLY','Artifactless historical assessment',"
              + q(ISSUER)
              + ",'source')");
      sql(
          c,
          "INSERT INTO"
              + " pattern_qa_assessment(id,pattern_revision_id,style_id,assessment_number,outcome,evidence_basis,artifact_id,notes,reviewer_issuer,reviewer_subject)"
              + " VALUES(gen_random_uuid(),"
              + q(ready.revision())
              + ","
              + q(ready.style())
              + ",1,'HUMAN_REVIEWED','READY_ARTIFACT',"
              + q(ready.artifact())
              + ",'Human historical attestation',"
              + q(ISSUER)
              + ",'source')");
      new GradingPersistenceTest().construct(c, "valid");
      UUID ms = UUID.randomUUID(), mr = UUID.randomUUID();
      sql(
          c,
          "INSERT INTO measurement_spec(id,style_id) VALUES("
              + q(ms)
              + ","
              + q(ready.style())
              + ")");
      sql(
          c,
          "INSERT INTO"
              + " measurement_revision(id,measurement_spec_id,style_id,revision_number,base_size,unit_system,created_by_issuer,created_by_subject)"
              + " VALUES("
              + q(mr)
              + ","
              + q(ms)
              + ","
              + q(ready.style())
              + ",1,'M','CM',"
              + q(ISSUER)
              + ",'source')");
      sql(
          c,
          "INSERT INTO measurement_point(measurement_revision_id,position,code,label,value) VALUES("
              + q(mr)
              + ",0,'CHEST','Chest',12.3456)");
      sql(c, "UPDATE measurement_revision SET sealed=true WHERE id=" + q(mr));
      sql(
          c,
          "INSERT INTO"
              + " audit_event(id,actor_issuer,actor_subject,organization_id,scope,action,request_id)"
              + " VALUES(gen_random_uuid(),"
              + q(ISSUER)
              + ",'source',"
              + q(ready.source())
              + ",'ORGANIZATION','synthetic.history','release-migration')");
      c.commit();
      before = snapshot.snapshot(c);
      triggers = snapshot.triggers(c);
      assertThat(before).hasSize(58);
      assertThat(before.get("pattern_qa_assessment")).hasSize(2);
    }
    var latest =
        Flyway.configure()
            .dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword())
            .target("23")
            .load();
    latest.migrate();
    latest.validate();
    assertThat(latest.info().applied()).hasSize(23);
    try (var c = DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword())) {
      var after = snapshot.snapshot(c);
      for (String t :
          List.of(
              "pattern_release",
              "pattern_release_event",
              "pattern_release_consent",
              "pattern_release_consent_event")) assertThat(after.remove(t)).isEmpty();
      assertThat(after).isEqualTo(before);
      assertThat(snapshot.triggers(c)).containsAll(triggers);
      assertThat(
              count(
                  c,
                  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND"
                      + " table_type='BASE TABLE'"))
          .isEqualTo(63);
    }
  }
}
