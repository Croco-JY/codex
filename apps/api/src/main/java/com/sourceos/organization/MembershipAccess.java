package com.sourceos.organization;

import com.sourceos.identity.Actor;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
class MembershipAccess implements com.sourceos.authorization.MembershipLookup {
  private final JdbcClient jdbc;

  public MembershipAccess(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public String role(Actor actor, UUID organization) {
    return jdbc.sql(
            "SELECT m.role FROM membership m JOIN organization o ON o.id=m.organization_id WHERE"
                + " m.organization_id=:org AND m.issuer=:issuer AND m.subject=:subject AND"
                + " m.status='ACTIVE' AND o.status='ACTIVE'")
        .param("org", organization)
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .query(String.class)
        .optional()
        .orElse(null);
  }
}
