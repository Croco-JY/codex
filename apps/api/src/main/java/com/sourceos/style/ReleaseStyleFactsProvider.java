package com.sourceos.style;

import com.sourceos.authorization.ReleaseAuthorization.*;
import com.sourceos.project.ReleaseProjectFactsProvider;
import java.util.*;
import org.springframework.aop.support.AopUtils;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.*;

@Component
public class ReleaseStyleFactsProvider {
  private final JdbcClient jdbc;
  private final ScopeVerifier verifier;
  private final ReleaseProjectFactsProvider projects;

  public ReleaseStyleFactsProvider(
      JdbcClient jdbc, ScopeVerifier verifier, ReleaseProjectFactsProvider projects) {
    if (!AopUtils.getTargetClass(projects).equals(ReleaseProjectFactsProvider.class))
      throw new IllegalStateException("Fixed Project facts required");
    this.jdbc = jdbc;
    this.verifier = verifier;
    this.projects = projects;
  }

  @Transactional(transactionManager = "transactionManager", propagation = Propagation.MANDATORY)
  public Map<UUID, StyleFact> read(List<Scope> scopes) {
    scopes.forEach(verifier::verify);
    if (scopes.isEmpty()) return Map.of();
    var parents = projects.read(scopes);
    var ids = scopes.stream().map(s -> s.candidate().style()).distinct().toList();
    var result = new HashMap<UUID, StyleFact>();
    jdbc.sql("SELECT id,project_id,status,version FROM style WHERE id IN (:ids)")
        .param("ids", ids)
        .query(
            (r, n) -> {
              UUID project = r.getObject(2, UUID.class);
              result.put(
                  r.getObject(1, UUID.class),
                  new StyleFact(project, r.getString(3), r.getLong(4), parents.get(project)));
              return 0;
            })
        .list();
    scopes.forEach(verifier::verify);
    return Map.copyOf(result);
  }
}
