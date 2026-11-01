package com.sourceos.pattern;

import com.sourceos.shared.ValidationRules;
import com.sourceos.style.ReleaseStyleContext;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

/** Own Pattern/Revision/Artifact SQL only. Public context is source-authorized. */
@Service
public class ReleasePatternContext {
  public record Artifact(
      UUID id,
      UUID objectId,
      String format,
      String displayName,
      long bytes,
      String sha256,
      String state) {}

  public record Context(
      UUID organizationId,
      UUID projectId,
      String projectStatus,
      long projectVersion,
      UUID styleId,
      String styleStatus,
      long styleVersion,
      UUID patternId,
      String status,
      long version,
      UUID revisionId,
      long revisionNumber,
      Artifact artifact) {}

  private final ReleaseStyleContext styles;
  private final JdbcClient jdbc;

  public ReleasePatternContext(ReleaseStyleContext styles, JdbcClient jdbc) {
    this.styles = styles;
    this.jdbc = jdbc;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public Context source(
      UUID org, UUID project, UUID style, UUID pattern, UUID revision, boolean lock) {
    var s = styles.source(org, project, style, lock);
    var p =
        jdbc.sql(
                "SELECT status,version FROM pattern WHERE id=:pattern AND style_id=:style"
                    + (lock ? " FOR UPDATE" : ""))
            .param("pattern", pattern)
            .param("style", style)
            .query((r, n) -> new Object[] {r.getString(1), r.getLong(2)})
            .optional()
            .orElseThrow(ValidationRules::missing);
    var result =
        jdbc.sql(
                "SELECT"
                    + " r.revision_number,a.id,a.storage_object_id,a.declared_format,a.display_name,a.size_bytes,a.sha256,a.state"
                    + " FROM pattern_revision r LEFT JOIN pattern_artifact a ON"
                    + " a.pattern_revision_id=r.id AND a.style_id=r.style_id WHERE r.id=:revision"
                    + " AND r.pattern_id=:pattern AND r.style_id=:style")
            .param("revision", revision)
            .param("pattern", pattern)
            .param("style", style)
            .query(
                (r, n) ->
                    new Context(
                        org,
                        project,
                        s.projectStatus(),
                        s.projectVersion(),
                        style,
                        s.status(),
                        s.version(),
                        pattern,
                        (String) p[0],
                        (Long) p[1],
                        revision,
                        r.getLong(1),
                        r.getObject(2, UUID.class) == null
                            ? null
                            : new Artifact(
                                r.getObject(2, UUID.class),
                                r.getObject(3, UUID.class),
                                r.getString(4),
                                r.getString(5),
                                r.getLong(6),
                                r.getString(7),
                                r.getString(8))))
            .optional()
            .orElseThrow(ValidationRules::missing);
    if (lock
        && (!s.projectStatus().equals("ACTIVE")
            || !s.status().equals("ACTIVE")
            || !result.status().equals("ACTIVE"))) throw ValidationRules.conflict();
    return result;
  }
}
