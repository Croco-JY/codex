package com.sourceos;

import com.sourceos.capability.CapabilityService;
import com.sourceos.dataingestion.SourceService;
import com.sourceos.facility.FacilityService;
import com.sourceos.geography.GeographyService;
import com.sourceos.supplier.SupplierService;
import com.sourceos.supplysearch.DirectorySearch;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.context.SecurityContextHolder;

abstract class DirectoryIntegrationSupport extends SupplyIntegrationSupport {
  @Autowired protected SupplierService suppliers;
  @Autowired protected FacilityService facilities;
  @Autowired protected CapabilityService capabilities;
  @Autowired protected GeographyService geography;
  @Autowired protected SourceService sources;
  @Autowired protected DirectorySearch search;
  static final UUID KR = UUID.fromString("00000000-0000-4000-8000-000000000001"),
      JP = UUID.fromString("00000000-0000-4000-8000-000000000002"),
      CN = UUID.fromString("00000000-0000-4000-8000-000000000003");
  protected String principal;
  protected UUID source, record, observation;

  @BeforeEach
  void prepareDirectory() {
    principal = admin();
    actor(principal);
    source =
        sources.source(
            null,
            new SourceService.SourceInput(
                "directory-" + id(),
                SourceService.SourceType.MANUAL_ENTRY,
                "Synthetic test dataset",
                null,
                null,
                SourceService.AccessMethod.MANUAL,
                SourceService.Normalization.PRESERVE,
                true,
                0));
    record =
        sources
            .record(
                new SourceService.RecordInput(source, SourceService.RecordKind.SUPPLIER, "root"))
            .id();
    observation = observation(record);
  }

  @AfterEach
  void clearDirectoryActor() {
    SecurityContextHolder.clearContext();
  }

  protected UUID observation(UUID record) {
    return sources
        .observe(
            new SourceService.ObservationInput(
                record,
                "test-" + id(),
                Instant.parse("2026-10-01T00:00:00Z"),
                null,
                "b".repeat(64),
                "SHA-256",
                null))
        .id();
  }

  protected SupplierService.Input supplierInput(UUID country, String name, long version) {
    return new SupplierService.Input(
        country,
        name,
        null,
        null,
        null,
        null,
        null,
        null,
        SupplierService.Status.ACTIVE,
        Set.of(SupplierService.Role.MILL, SupplierService.Role.MATERIAL_SUPPLIER),
        observation,
        version);
  }

  protected SupplierService.View supplier(UUID country, String name) {
    return suppliers.create(supplierInput(country, name, 0));
  }

  protected FacilityService.Input facilityInput(
      UUID supplier, UUID country, UUID region, UUID cluster, long version) {
    return new FacilityService.Input(
        supplier,
        FacilityService.Type.MILL,
        "Synthetic facility " + id(),
        country,
        region,
        cluster,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        FacilityService.Status.ACTIVE,
        observation,
        version);
  }

  protected FacilityService.View facility(UUID supplier, UUID country, UUID region, UUID cluster) {
    return facilities.create(facilityInput(supplier, country, region, cluster, 0));
  }

  protected UUID capability(UUID parent) {
    return capabilities.save(
        null,
        new CapabilityService.Input(
            "CAP_" + id().toString().replace("-", "").toUpperCase(Locale.ROOT),
            parent,
            CapabilityService.Category.MATERIAL_HANDLING,
            "Synthetic capability",
            null,
            null,
            true,
            0));
  }

  protected UUID region(UUID country, UUID parent) {
    return geography.region(
        null,
        new GeographyService.RegionInput(
            country,
            parent,
            null,
            "Synthetic region",
            null,
            GeographyService.RegionType.CITY,
            true,
            0));
  }

  protected void assign(UUID facility, UUID capability) {
    facilities.assign(
        facility,
        capability,
        new FacilityService.CapabilityInput(
            null, null, null, null, null, FacilityService.Verification.UNVERIFIED, observation, 0));
  }

  protected DirectorySearch.SupplierFilters filter(
      String q,
      String country,
      String facilityCountry,
      UUID region,
      UUID cluster,
      UUID capability,
      SupplierService.Role role,
      SupplierService.Verification verification) {
    return new DirectorySearch.SupplierFilters(
        country, role, verification, facilityCountry, region, cluster, capability, q);
  }
}
