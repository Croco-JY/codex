package com.sourceos.style;

import com.sourceos.project.ReleaseProjectContext;
import com.sourceos.shared.ValidationRules;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class ReleaseStyleContext {
  public record Context(
      UUID organizationId,
      UUID projectId,
      String projectStatus,
      long projectVersion,
      UUID styleId,
      String status,
      long version) {}

  private final ReleaseProjectContext projects;
  private final JdbcClient jdbc;

  public ReleaseStyleContext(ReleaseProjectContext projects, JdbcClient jdbc) {
    this.projects = projects;
    this.jdbc = jdbc;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public Context source(UUID org, UUID project, UUID style, boolean lock) {
    var p = projects.source(org, project, lock);
    return jdbc.sql(
            "SELECT status,version FROM style WHERE id=:style AND project_id=:project"
                + (lock ? " FOR UPDATE" : ""))
        .param("style", style)
        .param("project", project)
        .query(
            (r, n) ->
                new Context(
                    org, project, p.status(), p.version(), style, r.getString(1), r.getLong(2)))
        .optional()
        .orElseThrow(ValidationRules::missing);
  }
}
