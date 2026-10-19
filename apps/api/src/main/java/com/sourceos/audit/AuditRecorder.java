package com.sourceos.audit;

import com.sourceos.identity.Actor;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class AuditRecorder {
  private final JdbcClient jdbc;

  public AuditRecorder(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void record(Actor actor, UUID org, String action, String requestId) {
    jdbc.sql(
            "INSERT INTO"
                + " audit_event(id,actor_issuer,actor_subject,organization_id,action,request_id)"
                + " VALUES(:id,:issuer,:subject,:org,:action,:request)")
        .param("id", UUID.randomUUID())
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .param("org", org)
        .param("action", action)
        .param("request", requestId)
        .update();
  }
}
