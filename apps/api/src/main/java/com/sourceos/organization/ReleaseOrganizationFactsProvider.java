package com.sourceos.organization;

import com.sourceos.authorization.ReleaseAuthorization.*;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.*;

@Component("releaseOrganizationFacts")
public class ReleaseOrganizationFactsProvider implements OrganizationFacts {
  private final JdbcClient jdbc;
  private final ScopeVerifier verifier;

  public ReleaseOrganizationFactsProvider(JdbcClient jdbc, ScopeVerifier verifier) {
    this.jdbc = jdbc;
    this.verifier = verifier;
  }

  @Override
  @Transactional(transactionManager = "transactionManager", propagation = Propagation.MANDATORY)
  public Map<UUID, Root> read(List<Scope> scopes) {
    scopes.forEach(verifier::verify);
    if (scopes.isEmpty()) return Map.of();
    var ids = new HashSet<UUID>();
    for (var scope : scopes) {
      ids.add(scope.candidate().source());
      ids.add(scope.candidate().recipient());
    }
    var result = new HashMap<UUID, Root>();
    jdbc.sql("SELECT id,status,version FROM organization WHERE id IN (:ids)")
        .param("ids", ids)
        .query(
            (r, n) -> {
              result.put(r.getObject(1, UUID.class), new Root(r.getString(2), r.getLong(3)));
              return 0;
            })
        .list();
    scopes.forEach(verifier::verify);
    return Map.copyOf(result);
  }
}
