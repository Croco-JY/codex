package com.sourceos.geography;

import jakarta.validation.Valid;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class GeographyController {
  private final GeographyService service;

  GeographyController(GeographyService service) {
    this.service = service;
  }

  @GetMapping("/countries")
  List<GeographyService.Country> countries() {
    return service.countries();
  }

  @GetMapping("/regions")
  List<GeographyService.Region> regions(
      @RequestParam(required = false) UUID country,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.regions(country, limit, offset);
  }

  @GetMapping("/industrial-clusters")
  List<GeographyService.Cluster> clusters(
      @RequestParam(required = false) UUID country,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.clusters(country, limit, offset);
  }

  @PatchMapping("/admin/countries/{id}")
  void country(@PathVariable UUID id, @Valid @RequestBody GeographyService.CountryInput body) {
    service.country(id, body);
  }

  @PostMapping("/admin/regions")
  UUID region(@Valid @RequestBody GeographyService.RegionInput body) {
    return service.region(null, body);
  }

  @PutMapping("/admin/regions/{id}")
  UUID region(@PathVariable UUID id, @Valid @RequestBody GeographyService.RegionInput body) {
    return service.region(id, body);
  }

  @PostMapping("/admin/industrial-clusters")
  UUID cluster(@Valid @RequestBody GeographyService.ClusterInput body) {
    return service.cluster(null, body);
  }

  @PutMapping("/admin/industrial-clusters/{id}")
  UUID cluster(@PathVariable UUID id, @Valid @RequestBody GeographyService.ClusterInput body) {
    return service.cluster(id, body);
  }
}
