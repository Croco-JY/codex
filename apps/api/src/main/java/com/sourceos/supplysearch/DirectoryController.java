package com.sourceos.supplysearch;

import com.sourceos.facility.FacilityService;
import com.sourceos.supplier.SupplierService;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class DirectoryController {
  private final DirectorySearch search;

  DirectoryController(DirectorySearch search) {
    this.search = search;
  }

  @GetMapping("/suppliers")
  DirectorySearch.Page<DirectorySearch.SupplierHit> suppliers(
      @RequestParam(required = false) String country,
      @RequestParam(required = false) SupplierService.Role role,
      @RequestParam(required = false) SupplierService.Verification verificationStatus,
      @RequestParam(required = false) String facilityCountry,
      @RequestParam(required = false) UUID region,
      @RequestParam(required = false) UUID cluster,
      @RequestParam(required = false) UUID capability,
      @RequestParam(required = false) String q,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(required = false) String cursor) {
    return search.suppliers(
        new DirectorySearch.SupplierFilters(
            country, role, verificationStatus, facilityCountry, region, cluster, capability, q),
        limit,
        cursor);
  }

  @GetMapping("/facilities")
  DirectorySearch.Page<DirectorySearch.FacilityHit> facilities(
      @RequestParam(required = false) String country,
      @RequestParam(required = false) UUID region,
      @RequestParam(required = false) UUID cluster,
      @RequestParam(required = false) FacilityService.Type type,
      @RequestParam(required = false) UUID capability,
      @RequestParam(required = false) UUID supplier,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(required = false) String cursor) {
    return search.facilities(
        new DirectorySearch.FacilityFilters(country, region, cluster, type, capability, supplier),
        limit,
        cursor);
  }

  @GetMapping("/suppliers/{id}/facilities")
  DirectorySearch.Page<DirectorySearch.FacilityHit> supplierFacilities(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(required = false) String cursor) {
    return search.facilities(
        new DirectorySearch.FacilityFilters(null, null, null, null, null, id), limit, cursor);
  }
}
