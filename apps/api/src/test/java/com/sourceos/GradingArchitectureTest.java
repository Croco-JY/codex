package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.grading.GradingService;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class GradingArchitectureTest {
  @Test
  void independentStyleOwnedModuleWithoutForeignPersistenceOrGeometry() {
    var names =
        Arrays.stream(GradingService.class.getDeclaredFields())
            .map(f -> f.getType().getName())
            .toList();
    assertThat(names).contains("com.sourceos.style.StyleService");
    assertThat(names)
        .noneMatch(
            n ->
                n.startsWith("com.sourceos.pattern.")
                    || n.startsWith("com.sourceos.measurement.")
                    || n.startsWith("com.sourceos.file.")
                    || n.startsWith("com.sourceos.project.")
                    || n.endsWith("Repository")
                    || n.endsWith("Entity"));
    ApplicationModules.of(SourceOsApplication.class).verify();
  }
}
