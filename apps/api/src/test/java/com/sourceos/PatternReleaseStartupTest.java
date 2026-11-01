package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.sourceos.authorization.ReleaseAuthorization.*;
import javax.sql.DataSource;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.support.*;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** Actual complete application graph, with isolated invalid deployment configurations. */
class PatternReleaseStartupTest {
  static final PostgreSQLContainer DB = new PostgreSQLContainer("postgres:18.3");

  static {
    DB.start();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "missing",
        "duplicate",
        "fake",
        "extra-manager",
        "wrong-manager",
        "extra-source",
        "cycle"
      })
  void invalidReleaseDeploymentCannotStart(String kind) {
    new WebApplicationContextRunner()
        .withUserConfiguration(SourceOsApplication.class)
        .withInitializer(
            new org.springframework.boot.test.context.ConfigDataApplicationContextInitializer())
        .withPropertyValues(
            "spring.profiles.active=local",
            "source.cors-origins=http://127.0.0.1:5173",
            "spring.datasource.url=" + DB.getJdbcUrl(),
            "spring.datasource.username=" + DB.getUsername(),
            "spring.datasource.password=" + DB.getPassword(),
            "source.storage-root=/tmp/release-startup-storage")
        .withInitializer(
            context ->
                context.addBeanFactoryPostProcessor(
                    factory -> {
                      var registry = (BeanDefinitionRegistry) factory;
                      if (kind.equals("missing") || kind.equals("fake") || kind.equals("cycle"))
                        registry.removeBeanDefinition("releaseAccessFacts");
                      if (kind.equals("fake"))
                        factory.registerSingleton("releaseAccessFacts", mock(AccessFacts.class));
                      if (kind.equals("duplicate"))
                        factory.registerSingleton("unreviewedAccessFacts", mock(AccessFacts.class));
                      if (kind.equals("extra-manager"))
                        factory.registerSingleton(
                            "unexpectedManager", new DataSourceTransactionManager());
                      if (kind.equals("wrong-manager")) {
                        registry.removeBeanDefinition("transactionManager");
                        factory.registerSingleton(
                            "transactionManager", new DataSourceTransactionManager());
                      }
                      if (kind.equals("extra-source"))
                        factory.registerSingleton("unexpectedSource", mock(DataSource.class));
                      if (kind.equals("cycle")) {
                        var definition = new RootBeanDefinition(CyclicFacts.class);
                        definition
                            .getConstructorArgumentValues()
                            .addIndexedArgumentValue(
                                0,
                                new org.springframework.beans.factory.config.RuntimeBeanReference(
                                    "releaseAuthorizer"));
                        registry.registerBeanDefinition("releaseAccessFacts", definition);
                      }
                    }))
        .run(
            context -> {
              assertThat(context).hasFailed();
              String message =
                  switch (kind) {
                    case "missing" -> "releaseAccessFacts";
                    case "duplicate", "fake" ->
                        "One fixed reviewed release facts provider required";
                    case "cycle" -> "currently in creation";
                    default ->
                        "One explicitly selected JpaTransactionManager and guarded Hikari"
                            + " DataSource required";
                  };
              assertThat(context.getStartupFailure()).hasStackTraceContaining(message);
              PatternReleaseEvidence.write(
                  "F01-startup-" + kind,
                  java.util.Map.of(
                      "deployment",
                      kind,
                      "startup",
                      "REJECTED",
                      "expectedCause",
                      message,
                      "storageReads",
                      0));
            });
  }

  public static class CyclicFacts implements AccessFacts {
    public CyclicFacts(Authorizer authorizer) {}

    public Candidate recipient(
        com.sourceos.identity.Actor actor, java.util.UUID organization, java.util.UUID release) {
      throw new UnsupportedOperationException();
    }

    public Candidate source(
        com.sourceos.identity.Actor actor, java.util.UUID organization, java.util.UUID release) {
      throw new UnsupportedOperationException();
    }

    public CandidatePage inbox(
        com.sourceos.identity.Actor actor, java.util.UUID organization, int limit, String cursor) {
      throw new UnsupportedOperationException();
    }
  }
}
