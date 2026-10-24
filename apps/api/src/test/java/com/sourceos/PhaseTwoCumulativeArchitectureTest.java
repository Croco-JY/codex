package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;
import org.springframework.transaction.annotation.*;

class PhaseTwoCumulativeArchitectureTest {
  @Test
  void allDescendantsConsumePublicParentAndProviderContracts() throws Exception {
    for (String simple :
        List.of(
            "stylerequirement.StyleRequirementService",
            "stylematerialselection.StyleMaterialSelectionService",
            "stylefacilitycandidate.StyleFacilityCandidateService",
            "styledevelopmentreference.StyleDevelopmentReferenceService",
            "styledevelopmentreference.StyleDevelopmentReferenceTransactions")) {
      var fields =
          Arrays.stream(Class.forName("com.sourceos." + simple).getDeclaredFields())
              .map(f -> f.getType().getName())
              .toList();
      assertThat(fields)
          .as(simple)
          .noneMatch(
              t ->
                  t.startsWith("com.sourceos.project.")
                      || t.startsWith("com.sourceos.organization.")
                      || t.endsWith("Repository")
                      || t.endsWith("Entity")
                      || t.endsWith("StoragePort")
                      || t.endsWith("LocalStorageAdapter"));
      assertThat(fields).contains("com.sourceos.style.StyleService");
    }
    assertThat(
            Arrays.stream(com.sourceos.file.AuthorizedStorage.class.getDeclaredFields())
                .map(f -> f.getType().getName()))
        .noneMatch(t -> t.startsWith("com.sourceos.style") || t.startsWith("com.sourceos.project"));
    ApplicationModules.of(SourceOsApplication.class).verify();
  }

  @Test
  void providerLocksRequireOuterTransactionsAndReturnImmutableReferences() throws Exception {
    for (var method :
        List.of(
            com.sourceos.material.MaterialService.class.getMethod(
                "lockActiveReference", UUID.class),
            com.sourceos.material.MaterialService.class.getMethod(
                "lockActiveVariantReference", UUID.class, UUID.class),
            com.sourceos.materiallisting.ListingService.class.getMethod(
                "lockActiveReference", UUID.class, UUID.class),
            com.sourceos.facility.FacilityService.class.getMethod(
                "lockActiveReference", UUID.class))) {
      assertThat(method.getAnnotation(Transactional.class).propagation())
          .isEqualTo(Propagation.MANDATORY);
      assertThat(method.getReturnType().isRecord()).isTrue();
    }
    assertThat(
            Arrays.stream(com.sourceos.facility.FacilityService.class.getDeclaredMethods())
                .map(m -> m.getName()))
        .doesNotContain("readReference");
    assertThat(
            com.sourceos.style.StyleService.class
                .getMethod("lockContextForWrite", UUID.class, UUID.class, UUID.class)
                .getAnnotation(Transactional.class)
                .propagation())
        .isEqualTo(Propagation.MANDATORY);
  }
}
