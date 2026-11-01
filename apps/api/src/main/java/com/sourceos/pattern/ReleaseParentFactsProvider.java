package com.sourceos.pattern;

import com.sourceos.authorization.ReleaseAuthorization.*;
import com.sourceos.style.ReleaseStyleFactsProvider;
import java.util.*;
import org.springframework.aop.support.AopUtils;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.*;

@Component("releaseParentFacts")
public class ReleaseParentFactsProvider implements ParentFacts {
  private final JdbcClient jdbc;
  private final ScopeVerifier verifier;
  private final ReleaseStyleFactsProvider styles;

  public ReleaseParentFactsProvider(
      JdbcClient jdbc, ScopeVerifier verifier, ReleaseStyleFactsProvider styles) {
    if (!AopUtils.getTargetClass(styles).equals(ReleaseStyleFactsProvider.class))
      throw new IllegalStateException("Fixed Style facts required");
    this.jdbc = jdbc;
    this.verifier = verifier;
    this.styles = styles;
  }

  @Override
  @Transactional(transactionManager = "transactionManager", propagation = Propagation.MANDATORY)
  public Map<UUID, ParentFact> read(List<Scope> scopes) {
    scopes.forEach(verifier::verify);
    if (scopes.isEmpty()) return Map.of();
    var parents = styles.read(scopes);
    var ids = scopes.stream().map(s -> s.candidate().revision()).distinct().toList();
    var byRevision = new HashMap<UUID, ParentFact>();
    jdbc.sql(
            "SELECT"
                + " p.id,p.style_id,r.id,r.revision_number,p.status,p.version,a.id,a.storage_object_id,a.declared_format,a.display_name,a.size_bytes,a.sha256,a.state"
                + " FROM pattern p JOIN pattern_revision r ON r.pattern_id=p.id AND"
                + " r.style_id=p.style_id JOIN pattern_artifact a ON a.pattern_revision_id=r.id AND"
                + " a.style_id=r.style_id WHERE r.id IN (:ids)")
        .param("ids", ids)
        .query(
            (r, n) -> {
              var revision = r.getObject(3, UUID.class);
              var style = r.getObject(2, UUID.class);
              byRevision.put(
                  revision,
                  new ParentFact(
                      r.getObject(1, UUID.class),
                      style,
                      revision,
                      r.getLong(4),
                      r.getString(5),
                      r.getLong(6),
                      r.getObject(7, UUID.class),
                      r.getObject(8, UUID.class),
                      r.getString(9),
                      r.getString(10),
                      r.getLong(11),
                      r.getString(12),
                      r.getString(13),
                      parents.get(style)));
              return 0;
            })
        .list();
    var result = new HashMap<UUID, ParentFact>();
    for (var scope : scopes) {
      verifier.verify(scope);
      var p = byRevision.get(scope.candidate().revision());
      if (p != null) result.put(scope.candidate().id(), p);
    }
    return Map.copyOf(result);
  }
}
