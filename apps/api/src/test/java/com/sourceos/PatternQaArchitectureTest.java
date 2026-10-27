package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.patternqa.PatternQaService;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class PatternQaArchitectureTest {
  @Test
  void publicPatternProviderOnlyNoForeignPersistenceOrReverseDependency() {
    var names =
        Arrays.stream(PatternQaService.class.getDeclaredFields())
            .map(f -> f.getType().getName())
            .toList();
    assertThat(names).contains("com.sourceos.pattern.PatternQaContext");
    assertThat(names)
        .noneMatch(
            n ->
                n.contains("Repository")
                    || n.contains("Entity")
                    || n.startsWith("com.sourceos.style.")
                    || n.startsWith("com.sourceos.file.")
                    || n.startsWith("com.sourceos.grading.")
                    || n.startsWith("com.sourceos.measurement."));
    ApplicationModules.of(SourceOsApplication.class).verify();
  }
}
