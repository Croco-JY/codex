package com.sourceos.patternrelease;

import com.sourceos.authorization.ReleaseAuthorization.*;
import com.sourceos.identity.Actor;
import com.sourceos.shared.Keysets;
import java.sql.Types;
import java.util.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.*;

/** Fixed leaf: own release/event SQL only, no controller/command/File/authorizer dependency. */
@Component("releaseAccessFacts")
public class ReleaseAccessFactsProvider implements AccessFacts {
  private final JdbcClient jdbc;
  private final ScopeVerifier verifier;

  public ReleaseAccessFactsProvider(JdbcClient jdbc, ScopeVerifier verifier) {
    this.jdbc = jdbc;
    this.verifier = verifier;
  }

  private static final String SELECT =
      "SELECT r.*,(SELECT max(event_number) FROM pattern_release_event WHERE release_id=r.id) AS"
          + " head,EXISTS(SELECT 1 FROM pattern_release_event WHERE release_id=r.id AND"
          + " kind='REVOKED') AS revoked FROM pattern_release r ";
  private static final RowMapper<Candidate> ROW =
      (r, n) ->
          new Candidate(
              r.getObject("id", UUID.class),
              r.getObject("consent_id", UUID.class),
              r.getObject("source_organization_id", UUID.class),
              r.getObject("recipient_organization_id", UUID.class),
              r.getObject("project_id", UUID.class),
              r.getObject("style_id", UUID.class),
              r.getObject("pattern_id", UUID.class),
              r.getObject("pattern_revision_id", UUID.class),
              r.getLong("pattern_revision_number"),
              r.getObject("artifact_id", UUID.class),
              r.getObject("storage_object_id", UUID.class),
              r.getString("declared_format"),
              r.getString("display_name"),
              r.getLong("size_bytes"),
              r.getString("sha256"),
              r.getString("purpose"),
              r.getTimestamp("released_at").toInstant(),
              r.getTimestamp("expires_at").toInstant(),
              r.getLong("source_version"),
              r.getLong("recipient_version"),
              r.getLong("project_version"),
              r.getLong("style_version"),
              r.getLong("pattern_version"),
              r.getLong("head"),
              r.getBoolean("revoked"));

  @Override
  @Transactional(transactionManager = "transactionManager", propagation = Propagation.MANDATORY)
  public Candidate recipient(Actor actor, UUID recipient, UUID release) {
    verifier.verifyAccess(actor);
    return jdbc.sql(SELECT + "WHERE r.id=:id AND r.recipient_organization_id=:org")
        .param("id", release)
        .param("org", recipient)
        .query(ROW)
        .optional()
        .orElse(null);
  }

  @Override
  @Transactional(transactionManager = "transactionManager", propagation = Propagation.MANDATORY)
  public Candidate source(Actor actor, UUID source, UUID release) {
    verifier.verifyAccess(actor);
    return jdbc.sql(SELECT + "WHERE r.id=:id AND r.source_organization_id=:org")
        .param("id", release)
        .param("org", source)
        .query(ROW)
        .optional()
        .orElse(null);
  }

  @Override
  @Transactional(transactionManager = "transactionManager", propagation = Propagation.MANDATORY)
  public CandidatePage inbox(Actor actor, UUID recipient, int limit, String cursor) {
    verifier.verifyAccess(actor);
    var filter = List.of("received-pattern-releases", recipient);
    var anchor = Keysets.anchor(cursor, filter, limit);
    var rows =
        jdbc.sql(
                SELECT
                    + "WHERE r.recipient_organization_id=:org AND (CAST(:at AS timestamptz) IS NULL"
                    + " OR (r.released_at,r.id)<(:at,:after)) ORDER BY r.released_at DESC,r.id DESC"
                    + " LIMIT :limit")
            .param("org", recipient)
            .param("at", Keysets.time(anchor.at()), Types.TIMESTAMP_WITH_TIMEZONE)
            .param("after", anchor.id(), Types.OTHER)
            .param("limit", limit + 1)
            .query(ROW)
            .list();
    var page = Keysets.page(rows, limit, filter, Candidate::releasedAt, Candidate::id);
    return new CandidatePage(page.items(), page.nextCursor(), limit);
  }
}
