package com.sourceos;

import static org.assertj.core.api.Assertions.assertThat;

import com.sourceos.style.StyleService;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class ArchitectureTest {
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
