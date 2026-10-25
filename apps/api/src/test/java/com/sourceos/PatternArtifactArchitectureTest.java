package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.pattern.PatternArtifactService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class PatternArtifactArchitectureTest {
  @Test
  void authorizedStorageOnlyAndNoReverseModuleDependency() {
    var types =
        Arrays.stream(PatternArtifactService.class.getDeclaredFields())
            .map(f -> f.getType().getName())
            .toList();
    assertThat(types).contains("com.sourceos.file.AuthorizedStorage");
    assertThat(types)
        .noneMatch(
            t ->
                t.equals("com.sourceos.file.StoragePort")
                    || t.equals("com.sourceos.file.LocalStorageAdapter")
                    || t.startsWith("com.sourceos.project.")
                    || t.startsWith("com.sourceos.organization.")
                    || t.endsWith("Repository")
                    || t.endsWith("Entity"));
    ApplicationModules.of(SourceOsApplication.class).verify();
  }
}
