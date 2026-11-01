package com.sourceos.patternrelease;

import com.sourceos.authorization.ReleaseAuthorization.*;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.*;

@Component("releaseConsentFacts")
public class ReleaseConsentFactsProvider implements ConsentFacts {
  private final JdbcClient jdbc;
  private final ScopeVerifier verifier;

  public ReleaseConsentFactsProvider(JdbcClient jdbc, ScopeVerifier verifier) {
    this.jdbc = jdbc;
    this.verifier = verifier;
  }

  @Override
  @Transactional(transactionManager = "transactionManager", propagation = Propagation.MANDATORY)
  public Map<UUID, ConsentFact> read(List<Scope> scopes) {
    scopes.forEach(verifier::verify);
    if (scopes.isEmpty()) return Map.of();
    var ids = scopes.stream().map(s -> s.candidate().consent()).distinct().toList();
    var result = new HashMap<UUID, ConsentFact>();
    jdbc.sql(
            "SELECT c.id,c.recipient_organization_id,c.intended_source_organization_id,(SELECT"
                + " release_id FROM pattern_release_consent_event e WHERE e.consent_id=c.id AND"
                + " e.kind='CONSUMED') AS consumed,EXISTS(SELECT 1 FROM"
                + " pattern_release_consent_event e WHERE e.consent_id=c.id AND e.kind='WITHDRAWN')"
                + " AS withdrawn FROM pattern_release_consent c WHERE c.id IN (:ids)")
        .param("ids", ids)
        .query(
            (r, n) -> {
              result.put(
                  r.getObject(1, UUID.class),
                  new ConsentFact(
                      r.getObject(2, UUID.class),
                      r.getObject(3, UUID.class),
                      r.getObject(4, UUID.class),
                      r.getBoolean(5)));
              return 0;
            })
        .list();
    scopes.forEach(verifier::verify);
    return Map.copyOf(result);
  }
}
