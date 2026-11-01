package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.authorization.ReleaseAuthorization;
import com.sourceos.patternrelease.*;
import java.lang.reflect.Modifier;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class PatternReleaseArchitectureTest {
  private static Set<String> dependencies(Class<?> type) {
    return new com.tngtech.archunit.core.importer.ClassFileImporter()
        .importClass(type).getDirectDependenciesFromSelf().stream()
            .map(d -> d.getTargetClass().getName())
            .collect(java.util.stream.Collectors.toSet());
  }

  private static boolean unsupported(String name) {
    return name.equals("java.sql.DriverManager")
        || name.equals("javax.sql.DataSource")
        || name.equals("org.springframework.jdbc.datasource.DataSourceUtils")
        || name.startsWith("java.util.concurrent.")
        || name.contains("TransactionManager")
        || name.contains("TransactionTemplate");
  }

  @Test
  void fixedFactsLeavesCannotImportUnmanagedDriversConnectionsOrAsyncWork() {
    for (var type :
        List.of(
            ReleaseAccessFactsProvider.class,
            ReleaseConsentFactsProvider.class,
            com.sourceos.organization.ReleaseOrganizationFactsProvider.class,
            com.sourceos.project.ReleaseProjectFactsProvider.class,
            com.sourceos.style.ReleaseStyleFactsProvider.class,
            com.sourceos.pattern.ReleaseParentFactsProvider.class))
      assertThat(dependencies(type)).noneMatch(PatternReleaseArchitectureTest::unsupported);
    assertThat(dependencies(UnsafeDriverExample.class))
        .anyMatch(PatternReleaseArchitectureTest::unsupported);
  }

  static final class UnsafeDriverExample {
    java.sql.Connection read() throws java.sql.SQLException {
      return java.sql.DriverManager.getConnection("jdbc:postgresql://127.0.0.1/synthetic");
    }
  }

  @Test
  void actualCompleteCompileTimeGraphIsAcyclicAndVerifies() {
    ApplicationModules.of(SourceOsApplication.class).verify();
  }

  @Test
  void opaqueScopesAndBindingsHaveOnlyPrivateConstructors() {
    for (var type : List.of(ReleaseAuthorization.Scope.class, ReleaseAuthorization.Binding.class))
      assertThat(
              Arrays.stream(type.getDeclaredConstructors())
                  .allMatch(c -> Modifier.isPrivate(c.getModifiers())))
          .isTrue();
    assertThat(
            Arrays.stream(com.sourceos.file.ReleaseContentGateway.class.getDeclaredMethods())
                .filter(m -> Modifier.isPublic(m.getModifiers()))
                .map(java.lang.reflect.Method::getName))
        .containsExactly("download");
  }

  @Test
  void noForeignPersistenceNoUncheckedStorageAndFixedFactLeaves() {
    for (var type :
        List.of(
            PatternReleaseService.class,
            ReleaseConsentService.class,
            ReleaseAccessFactsProvider.class,
            ReleaseConsentFactsProvider.class,
            ReleaseDownloadFacade.class)) {
      assertThat(Arrays.stream(type.getDeclaredFields()).map(f -> f.getType().getName()).toList())
          .noneMatch(
              n ->
                  n.endsWith("Repository")
                      || n.endsWith("Entity")
                      || n.endsWith("StoragePort")
                      || n.contains("LocalStorageAdapter"));
    }
    for (var type :
        List.of(
            ReleaseAccessFactsProvider.class,
            ReleaseConsentFactsProvider.class,
            com.sourceos.organization.ReleaseOrganizationFactsProvider.class,
            com.sourceos.project.ReleaseProjectFactsProvider.class,
            com.sourceos.style.ReleaseStyleFactsProvider.class,
            com.sourceos.pattern.ReleaseParentFactsProvider.class)) {
      assertThat(Arrays.stream(type.getDeclaredFields()).map(f -> f.getType().getName()).toList())
          .noneMatch(
              n ->
                  n.equals("javax.sql.DataSource")
                      || n.startsWith("java.sql.")
                      || n.equals("com.sourceos.authorization.ReleaseAuthorization$Authorizer")
                      || n.startsWith("com.sourceos.file.")
                      || n.contains("Executor")
                      || n.contains("TransactionManager")
                      || n.endsWith("Repository")
                      || n.endsWith("Entity"));
      assertThat(
              Arrays.stream(type.getDeclaredMethods())
                  .filter(m -> Modifier.isPublic(m.getModifiers()))
                  .toList())
          .allMatch(
              m -> {
                var tx =
                    m.getAnnotation(org.springframework.transaction.annotation.Transactional.class);
                return tx != null
                    && tx.transactionManager().equals("transactionManager")
                    && tx.propagation()
                        == org.springframework.transaction.annotation.Propagation.MANDATORY;
              });
    }
    assertThat(
            Arrays.stream(com.sourceos.file.ReleaseContentGateway.class.getDeclaredFields())
                .map(f -> f.getType().getPackageName()))
        .noneMatch(
            n ->
                n.startsWith("com.sourceos.pattern")
                    || n.equals("org.springframework.jdbc.core.simple"));
  }
}
