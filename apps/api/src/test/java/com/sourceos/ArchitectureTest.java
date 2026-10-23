package com.sourceos;

import static org.assertj.core.api.Assertions.assertThat;

import com.sourceos.style.StyleService;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class ArchitectureTest {
  @Test
  void requirementConsumesStyleWithoutDirectProjectDependency() {
    var type = com.sourceos.stylerequirement.StyleRequirementService.class;
    var fields =
        java.util.Arrays.stream(type.getDeclaredFields())
            .map(f -> f.getType().getPackageName())
            .toList();
    assertThat(fields).doesNotContain("com.sourceos.project");
    assertThat(fields).contains("com.sourceos.style");
  }

  @Test
  void boundaries() {
    ApplicationModules.of(SourceOsApplication.class).verify();
  }

  @Test
  void styleContextOwnsItsParentLifecycleType() throws Exception {
    var projectStatus = StyleService.StyleContext.class.getMethod("projectStatus");

    assertThat(projectStatus.getReturnType()).isEqualTo(StyleService.ParentStatus.class);
    assertThat(projectStatus.getReturnType().getPackageName()).isEqualTo("com.sourceos.style");
  }
}
