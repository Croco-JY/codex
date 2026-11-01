package com.sourceos.authorization;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.sourceos.identity.*;
import java.time.Instant;
import java.util.*;
import javax.sql.DataSource;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.*;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.stereotype.*;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** Fixed policy and immutable minimum fact contracts. No domain persistence or File dependency. */
public final class ReleaseAuthorization {
  private ReleaseAuthorization() {}

  public record Candidate(
      UUID id,
      UUID consent,
      UUID source,
      UUID recipient,
      UUID project,
      UUID style,
      UUID pattern,
      UUID revision,
      long revisionNumber,
      UUID artifact,
      UUID object,
      String format,
      String displayName,
      long bytes,
      String sha256,
      String purpose,
      Instant releasedAt,
      Instant expiresAt,
      long sourceVersion,
      long recipientVersion,
      long projectVersion,
      long styleVersion,
      long patternVersion,
      long eventNumber,
      boolean revoked) {}

  public record CandidatePage(List<Candidate> items, String nextCursor, int limit) {}

  public record Root(String status, long version) {}

  public record ProjectFact(UUID organization, String status, long version) {}

  public record StyleFact(UUID project, String status, long version, ProjectFact parent) {}

  public record ParentFact(
      UUID pattern,
      UUID style,
      UUID revision,
      long revisionNumber,
      String status,
      long version,
      UUID artifact,
      UUID object,
      String format,
      String displayName,
      long bytes,
      String sha256,
      String artifactState,
      StyleFact parent) {}

  public record ConsentFact(
      UUID recipient, UUID intendedSource, UUID consumedRelease, boolean withdrawn) {}

  public record Inspection(Candidate candidate, String effectiveState) {}

  public record InspectionPage(List<Inspection> items, String nextCursor, int limit) {}

  public interface AccessFacts {
    Candidate recipient(Actor actor, UUID recipient, UUID release);

    Candidate source(Actor actor, UUID source, UUID release);

    CandidatePage inbox(Actor actor, UUID recipient, int limit, String cursor);
  }

  public interface OrganizationFacts {
    Map<UUID, Root> read(List<Scope> scopes);
  }

  public interface ParentFacts {
    Map<UUID, ParentFact> read(List<Scope> scopes);
  }

  public interface ConsentFacts {
    Map<UUID, ConsentFact> read(List<Scope> scopes);
  }

  @JsonAutoDetect(
      creatorVisibility = JsonAutoDetect.Visibility.NONE,
      fieldVisibility = JsonAutoDetect.Visibility.NONE,
      getterVisibility = JsonAutoDetect.Visibility.NONE,
      isGetterVisibility = JsonAutoDetect.Visibility.NONE)
  public static final class Scope {
    private final Candidate candidate;
    private final Actor actor;
    private final ReleaseTransactionFence.Lease lease;

    private Scope(Candidate candidate, Actor actor) {
      this.candidate = candidate;
      this.actor = actor;
      this.lease = ReleaseTransactionFence.require();
    }

    public Candidate candidate() {
      return candidate;
    }
  }

  @JsonAutoDetect(
      creatorVisibility = JsonAutoDetect.Visibility.NONE,
      fieldVisibility = JsonAutoDetect.Visibility.NONE,
      getterVisibility = JsonAutoDetect.Visibility.NONE,
      isGetterVisibility = JsonAutoDetect.Visibility.NONE)
  public static final class Binding {
    private final Candidate candidate;
    private final Actor actor;

    private Binding(Candidate c, Actor actor) {
      candidate = c;
      this.actor = actor;
    }

    public Candidate candidate() {
      return candidate;
    }

    public Actor actor() {
      return actor;
    }
  }

  public static ResponseStatusException unavailable() {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "Release unavailable");
  }

  @Component
  public static class ScopeVerifier {
    private final IdentityService identities;

    public ScopeVerifier(IdentityService identities) {
      this.identities = identities;
    }

    public void verify(Scope scope) {
      var active = ReleaseTransactionFence.current();
      if (scope != null && scope.lease != active) {
        // A captured scope carries its origin even across a thread without a ThreadLocal.
        // Poison both affected owners; swallowing a worker exception cannot revive either.
        scope.lease.poison("Scope escaped its owner");
        if (active != null) active.reject("Foreign scope");
        throw unavailable();
      }
      var l = ReleaseTransactionFence.require();
      if (scope == null || !scope.actor.equals(identities.current()))
        l.reject("Scope or Actor changed");
    }

    public void verifyAccess(Actor actor) {
      var l = ReleaseTransactionFence.require();
      if (actor == null || !actor.equals(identities.current())) l.reject("Facts Actor changed");
    }
  }

  @Service("releaseAuthorizer")
  public static class Authorizer implements SmartInitializingSingleton {
    private final IdentityService identities;
    private final OrganizationAuthorization membership;
    private final DataSource dataSource;
    private final JdbcClient jdbc;
    private final PlatformTransactionManager manager;
    private final AccessFacts access;
    private final OrganizationFacts organizations;
    private final ParentFacts parents;
    private final ConsentFacts consents;
    private final ApplicationContext context;

    public Authorizer(
        IdentityService identities,
        OrganizationAuthorization membership,
        @Qualifier("dataSource") DataSource dataSource,
        JdbcClient jdbc,
        @Qualifier("transactionManager") PlatformTransactionManager manager,
        @Qualifier("releaseAccessFacts") AccessFacts access,
        List<AccessFacts> allAccess,
        @Qualifier("releaseOrganizationFacts") OrganizationFacts organizations,
        List<OrganizationFacts> allOrganizations,
        @Qualifier("releaseParentFacts") ParentFacts parents,
        List<ParentFacts> allParents,
        @Qualifier("releaseConsentFacts") ConsentFacts consents,
        List<ConsentFacts> allConsents,
        ApplicationContext context) {
      fixed(access, allAccess, "com.sourceos.patternrelease.ReleaseAccessFactsProvider");
      fixed(
          organizations,
          allOrganizations,
          "com.sourceos.organization.ReleaseOrganizationFactsProvider");
      fixed(parents, allParents, "com.sourceos.pattern.ReleaseParentFactsProvider");
      fixed(consents, allConsents, "com.sourceos.patternrelease.ReleaseConsentFactsProvider");
      this.identities = identities;
      this.membership = membership;
      this.dataSource = dataSource;
      this.jdbc = jdbc;
      this.manager = manager;
      this.access = access;
      this.organizations = organizations;
      this.parents = parents;
      this.consents = consents;
      this.context = context;
    }

    private static void fixed(Object selected, List<?> all, String reviewedClass) {
      if (all.size() != 1 || !AopUtils.getTargetClass(selected).getName().equals(reviewedClass))
        throw new IllegalStateException("One fixed reviewed release facts provider required");
    }

    @Override
    public void afterSingletonsInstantiated() {
      if (context.getBeansOfType(DataSource.class).size() != 1
          || context.getBeansOfType(PlatformTransactionManager.class).size() != 1
          || !(dataSource instanceof ReleaseDataSource ds)
          || !ds.poolType().equals("com.zaxxer.hikari.HikariDataSource")
          || !AopUtils.getTargetClass(manager).equals(JpaTransactionManager.class)
          || !(manager instanceof JpaTransactionManager jpa)
          || jpa.getDataSource() != dataSource)
        throw new IllegalStateException(
            "One explicitly selected JpaTransactionManager and guarded Hikari DataSource required");
    }

    private <T> T owned(java.util.function.Supplier<T> work) {
      if (ReleaseTransactionFence.current() != null)
        ReleaseTransactionFence.current().reject("Recursive authorizer");
      var tx = new TransactionTemplate(manager);
      tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
      tx.setReadOnly(true);
      tx.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
      final ReleaseTransactionFence.Lease[] held = new ReleaseTransactionFence.Lease[1];
      try {
        T result =
            tx.execute(
                status -> {
                  var lease = ReleaseTransactionFence.enter(dataSource, status);
                  held[0] = lease;
                  try {
                    var settings =
                        jdbc.sql(
                                "SELECT"
                                    + " current_setting('transaction_isolation'),current_setting('transaction_read_only')")
                            .query(
                                (r, n) ->
                                    r.getString(1).equals("repeatable read")
                                        && r.getString(2).equals("on"))
                            .single();
                    if (!settings) lease.reject("Physical transaction configuration changed");
                    return work.get();
                  } finally {
                    ReleaseTransactionFence.completing(lease);
                  }
                });
        held[0].healthy();
        return result;
      } catch (RuntimeException failure) {
        if (held[0] != null) held[0].healthy();
        throw failure;
      } finally {
        if (held[0] != null) ReleaseTransactionFence.clear(held[0]);
      }
    }

    public Binding authorize(UUID recipient, UUID release) {
      return owned(
          () -> {
            Actor actor = identities.current();
            membership.requireRead(recipient);
            Candidate candidate = access.recipient(actor, recipient, release);
            if (candidate == null
                || !candidate.recipient().equals(recipient)
                || !candidate.id().equals(release)) throw unavailable();
            var inspection = inspect(List.of(candidate), actor).getFirst();
            if (!inspection.effectiveState().equals("ACTIVE")) throw unavailable();
            ReleaseTransactionFence.require();
            return new Binding(candidate, actor);
          });
    }

    public Inspection inspectRecipient(UUID recipient, UUID release) {
      return owned(
          () -> {
            var actor = identities.current();
            membership.requireRead(recipient);
            var c = access.recipient(actor, recipient, release);
            if (c == null || !c.recipient().equals(recipient) || !c.id().equals(release))
              throw unavailable();
            return inspect(List.of(c), actor).getFirst();
          });
    }

    public Inspection inspectSource(UUID source, UUID release) {
      return owned(
          () -> {
            var actor = identities.current();
            membership.requireRead(source);
            var c = access.source(actor, source, release);
            if (c == null || !c.source().equals(source) || !c.id().equals(release))
              throw unavailable();
            return inspect(List.of(c), actor).getFirst();
          });
    }

    public InspectionPage inbox(UUID recipient, int limit, String cursor) {
      return owned(
          () -> {
            var actor = identities.current();
            membership.requireRead(recipient);
            var page = access.inbox(actor, recipient, limit, cursor);
            if (page.items().stream().anyMatch(c -> !c.recipient().equals(recipient)))
              throw unavailable();
            return new InspectionPage(
                inspect(page.items(), actor), page.nextCursor(), page.limit());
          });
    }

    private List<Inspection> inspect(List<Candidate> candidates, Actor actor) {
      var scopes = candidates.stream().map(c -> new Scope(c, actor)).toList();
      var roots = organizations.read(scopes);
      var hierarchy = parents.read(scopes);
      var consent = consents.read(scopes);
      Instant wall =
          jdbc.sql("SELECT clock_timestamp()")
              .query((r, n) -> r.getTimestamp(1).toInstant())
              .single();
      if (!actor.equals(identities.current()))
        ReleaseTransactionFence.require().reject("Actor changed during facts");
      var result = new ArrayList<Inspection>();
      for (Candidate c : candidates) {
        var p = hierarchy.get(c.id());
        var q = consent.get(c.consent());
        String state = "ACTIVE";
        if (!bindingValid(c, p, q, roots)) state = "UNAVAILABLE";
        else if (q.withdrawn()) state = "WITHDRAWN";
        else if (c.revoked()) state = "REVOKED";
        else if (!wall.isBefore(c.expiresAt())) state = "EXPIRED";
        result.add(new Inspection(c, state));
      }
      ReleaseTransactionFence.require();
      return List.copyOf(result);
    }

    private static boolean root(Root r, long expected) {
      return r != null && r.status().equals("ACTIVE") && r.version() == expected;
    }

    private static boolean bindingValid(
        Candidate c, ParentFact p, ConsentFact consent, Map<UUID, Root> roots) {
      return !c.source().equals(c.recipient())
          && c.bytes() >= 1
          && c.bytes() <= 10485760
          && c.sha256() != null
          && c.sha256().matches("[0-9a-f]{64}")
          && root(roots.get(c.source()), c.sourceVersion())
          && root(roots.get(c.recipient()), c.recipientVersion())
          && consent != null
          && consent.recipient().equals(c.recipient())
          && consent.intendedSource().equals(c.source())
          && c.id().equals(consent.consumedRelease())
          && p != null
          && p.parent() != null
          && p.parent().parent() != null
          && p.pattern().equals(c.pattern())
          && p.style().equals(c.style())
          && p.revision().equals(c.revision())
          && p.revisionNumber() == c.revisionNumber()
          && p.status().equals("ACTIVE")
          && p.version() == c.patternVersion()
          && p.parent().status().equals("ACTIVE")
          && p.parent().version() == c.styleVersion()
          && p.parent().project().equals(c.project())
          && p.parent().parent().organization().equals(c.source())
          && p.parent().parent().status().equals("ACTIVE")
          && p.parent().parent().version() == c.projectVersion()
          && p.artifact().equals(c.artifact())
          && p.artifactState().equals("READY")
          && p.object().equals(c.object())
          && p.bytes() == c.bytes()
          && p.sha256().equals(c.sha256())
          && p.format().equals(c.format())
          && p.displayName().equals(c.displayName());
    }
  }
}
