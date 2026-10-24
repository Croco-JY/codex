package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.measurement.MeasurementService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class MeasurementArchitectureTest {
  @Test
  void publicStyleIdentityAuditOnlyNoForeignPersistence() {
    var fields =
        Arrays.stream(MeasurementService.class.getDeclaredFields())
            .map(f -> f.getType().getName())
            .toList();
    assertThat(fields)
        .contains(
            "com.sourceos.style.StyleService",
            "com.sourceos.identity.IdentityService",
            "com.sourceos.audit.AuditRecorder");
    assertThat(fields)
        .noneMatch(
            t ->
                t.startsWith("com.sourceos.project.")
                    || t.startsWith("com.sourceos.organization.")
                    || t.startsWith("com.sourceos.file.")
                    || t.startsWith("com.sourceos.material")
                    || t.endsWith("Repository")
                    || t.endsWith("Entity"));
    ApplicationModules.of(SourceOsApplication.class).verify();
  }
}
