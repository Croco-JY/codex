package com.sourceos;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class ArchitectureTest {
  @Test
  void boundaries() {
    ApplicationModules.of(SourceOsApplication.class).verify();
  }
}
