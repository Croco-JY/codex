package com.sourceos;

import java.sql.*;
import java.util.*;

/** Real, isolated PostgreSQL construction; never disables immutable guards. */
final class PatternReleaseSqlFixture {
  static final String ISSUER = "urn:source-os:release-sql";

  record Family(
      UUID source,
      UUID recipient,
      UUID project,
      UUID style,
      UUID pattern,
      UUID revision,
      UUID artifact,
      UUID object) {}

  static String q(Object value) {
    return "'" + value.toString().replace("'", "''") + "'";
  }

  static void sql(Connection c, String s) throws SQLException {
    try (var st = c.createStatement()) {
      st.execute(s);
    }
  }

  static long count(Connection c, String s) throws SQLException {
    try (var st = c.createStatement();
        var rs = st.executeQuery(s)) {
      rs.next();
      return rs.getLong(1);
    }
  }

  static Family seed(Connection c, String artifactState) throws SQLException {
    var f =
        new Family(
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID());
    sql(
        c,
        "INSERT INTO organization(id,name) VALUES("
            + q(f.source)
            + ",'Source'),("
            + q(f.recipient)
            + ",'Recipient')");
    sql(
        c,
        "INSERT INTO membership(id,organization_id,issuer,subject,role) VALUES(gen_random_uuid(),"
            + q(f.source)
            + ","
            + q(ISSUER)
            + ",'source','ORG_OWNER'),(gen_random_uuid(),"
            + q(f.recipient)
            + ","
            + q(ISSUER)
            + ",'recipient','ORG_OWNER')");
    sql(
        c,
        "INSERT INTO project(id,organization_id,name) VALUES("
            + q(f.project)
            + ","
            + q(f.source)
            + ",'Project')");
    sql(
        c,
        "INSERT INTO style(id,project_id,name) VALUES("
            + q(f.style)
            + ","
            + q(f.project)
            + ",'Style')");
    sql(c, "INSERT INTO pattern(id,style_id) VALUES(" + q(f.pattern) + "," + q(f.style) + ")");
    boolean artifact = !artifactState.equals("NONE");
    sql(
        c,
        "INSERT INTO"
            + " pattern_revision(id,pattern_id,style_id,revision_number,name,created_by_issuer,created_by_subject,artifact_expected)"
            + " VALUES("
            + q(f.revision)
            + ","
            + q(f.pattern)
            + ","
            + q(f.style)
            + ",1,'Exact revision',"
            + q(ISSUER)
            + ",'source',"
            + artifact
            + ")");
    if (artifact) {
      sql(
          c,
          "INSERT INTO"
              + " pattern_artifact(id,pattern_revision_id,style_id,storage_object_id,declared_format,display_name,size_bytes,sha256,state)"
              + " VALUES("
              + q(f.artifact)
              + ","
              + q(f.revision)
              + ","
              + q(f.style)
              + ","
              + q(f.object)
              + ",'PDF','Pattern.pdf',3,repeat('a',64),'PENDING')");
      if (!artifactState.equals("PENDING"))
        sql(
            c,
            "UPDATE pattern_artifact SET state="
                + q(artifactState)
                + ",version=1,updated_at=clock_timestamp()+interval '1 microsecond',failure_code="
                + (artifactState.equals("FAILED") ? "'STORAGE_WRITE_FAILED'" : "null")
                + " WHERE id="
                + q(f.artifact));
    }
    return f;
  }

  static UUID consent(Connection c, Family f) throws SQLException {
    UUID id = UUID.randomUUID();
    sql(
        c,
        "INSERT INTO"
            + " pattern_release_consent(id,recipient_organization_id,intended_source_organization_id,issuer,subject)"
            + " VALUES("
            + q(id)
            + ","
            + q(f.recipient)
            + ","
            + q(f.source)
            + ","
            + q(ISSUER)
            + ",'recipient')");
    consentEvent(c, f, id, 1, "ISSUED", null);
    return id;
  }

  static void consentEvent(Connection c, Family f, UUID consent, long n, String kind, UUID release)
      throws SQLException {
    sql(
        c,
        "INSERT INTO"
            + " pattern_release_consent_event(id,consent_id,recipient_organization_id,event_number,kind,release_id,actor_organization_id,issuer,subject)"
            + " VALUES(gen_random_uuid(),"
            + q(consent)
            + ","
            + q(f.recipient)
            + ","
            + n
            + ","
            + q(kind)
            + ","
            + (release == null ? "null" : q(release))
            + ","
            + q(kind.equals("CONSUMED") ? f.source : f.recipient)
            + ","
            + q(ISSUER)
            + ","
            + q(kind.equals("CONSUMED") ? "source" : "recipient")
            + ")");
  }

  static String releaseSql(Family f, UUID consent, UUID id, Map<String, String> changes) {
    var values = new LinkedHashMap<String, String>();
    values.put("id", q(id));
    values.put("consent_id", q(consent));
    values.put("source_organization_id", q(f.source));
    values.put("recipient_organization_id", q(f.recipient));
    values.put("project_id", q(f.project));
    values.put("style_id", q(f.style));
    values.put("pattern_id", q(f.pattern));
    values.put("pattern_revision_id", q(f.revision));
    values.put("pattern_revision_number", "1");
    values.put("artifact_id", q(f.artifact));
    values.put("storage_object_id", q(f.object));
    values.put("declared_format", "'PDF'");
    values.put("display_name", "'Pattern.pdf'");
    values.put("size_bytes", "3");
    values.put("sha256", "repeat('a',64)");
    values.put("purpose", "'Review this exact revision'");
    values.put("access_duration_seconds", "86400");
    for (String x :
        List.of(
            "source_version",
            "recipient_version",
            "project_version",
            "style_version",
            "pattern_version")) values.put(x, "0");
    values.put("issuer", q(ISSUER));
    values.put("subject", "'source'");
    values.putAll(changes);
    return "INSERT INTO pattern_release("
        + String.join(",", values.keySet())
        + ") VALUES("
        + String.join(",", values.values())
        + ")";
  }

  static void releaseEvent(Connection c, Family f, UUID release, long n, String kind)
      throws SQLException {
    sql(
        c,
        "INSERT INTO"
            + " pattern_release_event(id,release_id,source_organization_id,event_number,kind,actor_organization_id,issuer,subject)"
            + " VALUES(gen_random_uuid(),"
            + q(release)
            + ","
            + q(f.source)
            + ","
            + n
            + ","
            + q(kind)
            + ","
            + q(f.source)
            + ","
            + q(ISSUER)
            + ",'source')");
  }

  static UUID release(Connection c, Family f, UUID consent) throws SQLException {
    UUID id = UUID.randomUUID();
    sql(c, releaseSql(f, consent, id, Map.of()));
    releaseEvent(c, f, id, 1, "ACTIVATED");
    consentEvent(c, f, consent, 2, "CONSUMED", id);
    return id;
  }
}
