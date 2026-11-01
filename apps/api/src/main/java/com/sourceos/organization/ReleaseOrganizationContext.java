package com.sourceos.organization;

import com.sourceos.authorization.OrganizationAuthorization;
import com.sourceos.shared.ValidationRules;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

/** Additive write boundary; no domain receives Organization entities or repositories. */
@Service
public class ReleaseOrganizationContext {
  public record Root(UUID id, String status, long version) {}

  public record Roots(Root source, Root recipient) {}

  private final JdbcClient jdbc;
  private final OrganizationAuthorization authorization;

  public ReleaseOrganizationContext(JdbcClient jdbc, OrganizationAuthorization authorization) {
    this.jdbc = jdbc;
    this.authorization = authorization;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public Root lockRecipient(UUID org) {
    authorization.requireWrite(org);
    var r =
        jdbc.sql("SELECT id,status,version FROM organization WHERE id=:id FOR NO KEY UPDATE")
            .param("id", org)
            .query((rs, n) -> new Root(rs.getObject(1, UUID.class), rs.getString(2), rs.getLong(3)))
            .single();
    authorization.requireWrite(org);
    if (!r.status().equals("ACTIVE")) throw ValidationRules.conflict();
    return r;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public Roots lockSource(UUID source, UUID recipient, boolean requireRecipientActive) {
    authorization.requireWrite(source);
    if (source.equals(recipient)) throw ValidationRules.bad("Distinct Organizations required");
    var rows =
        jdbc.sql(
                "SELECT id,status,version FROM organization WHERE id IN (:source,:recipient) ORDER"
                    + " BY id FOR NO KEY UPDATE")
            .param("source", source)
            .param("recipient", recipient)
            .query((rs, n) -> new Root(rs.getObject(1, UUID.class), rs.getString(2), rs.getLong(3)))
            .list();
    if (rows.size() != 2) throw ValidationRules.missing();
    var s =
        rows.stream()
            .filter(r -> r.id().equals(source))
            .findFirst()
            .orElseThrow(ValidationRules::missing);
    var r =
        rows.stream()
            .filter(x -> x.id().equals(recipient))
            .findFirst()
            .orElseThrow(ValidationRules::missing);
    authorization.requireWrite(source);
    if (!s.status().equals("ACTIVE") || requireRecipientActive && !r.status().equals("ACTIVE"))
      throw ValidationRules.conflict();
    return new Roots(s, r);
  }
}
