package com.sourceos.project;

import com.sourceos.authorization.OrganizationAuthorization;
import com.sourceos.shared.ValidationRules;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

/** Scoped source metadata/write context, never a recipient authorization bypass. */
@Service
public class ReleaseProjectContext {
  public record Context(UUID organizationId, UUID projectId, String status, long version) {}

  private final JdbcClient jdbc;
  private final OrganizationAuthorization auth;

  public ReleaseProjectContext(JdbcClient jdbc, OrganizationAuthorization auth) {
    this.jdbc = jdbc;
    this.auth = auth;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public Context source(UUID org, UUID project, boolean lock) {
    if (lock) auth.requireWrite(org);
    else auth.requireRead(org);
    return jdbc.sql(
            "SELECT status,version FROM project WHERE id=:project AND organization_id=:org"
                + (lock ? " FOR UPDATE" : ""))
        .param("project", project)
        .param("org", org)
        .query((r, n) -> new Context(org, project, r.getString(1), r.getLong(2)))
        .optional()
        .orElseThrow(ValidationRules::missing);
  }
}
