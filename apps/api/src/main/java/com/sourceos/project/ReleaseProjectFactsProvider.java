package com.sourceos.project;

import com.sourceos.authorization.ReleaseAuthorization.*;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.*;

@Component
public class ReleaseProjectFactsProvider {
  private final JdbcClient jdbc;
  private final ScopeVerifier verifier;

  public ReleaseProjectFactsProvider(JdbcClient jdbc, ScopeVerifier verifier) {
    this.jdbc = jdbc;
    this.verifier = verifier;
  }

  @Transactional(transactionManager = "transactionManager", propagation = Propagation.MANDATORY)
  public Map<UUID, ProjectFact> read(List<Scope> scopes) {
    scopes.forEach(verifier::verify);
    if (scopes.isEmpty()) return Map.of();
    var ids = scopes.stream().map(s -> s.candidate().project()).distinct().toList();
    var result = new HashMap<UUID, ProjectFact>();
    jdbc.sql("SELECT id,organization_id,status,version FROM project WHERE id IN (:ids)")
        .param("ids", ids)
        .query(
            (r, n) -> {
              result.put(
                  r.getObject(1, UUID.class),
                  new ProjectFact(r.getObject(2, UUID.class), r.getString(3), r.getLong(4)));
              return 0;
            })
        .list();
    scopes.forEach(verifier::verify);
    return Map.copyOf(result);
  }
}
