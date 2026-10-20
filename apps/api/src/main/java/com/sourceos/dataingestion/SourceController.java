package com.sourceos.dataingestion;

import jakarta.validation.Valid;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/admin")
class SourceController {
  private final SourceService service;

  SourceController(SourceService service) {
    this.service = service;
  }

  @GetMapping("/sources")
  List<SourceService.SourceView> sources(
      @RequestParam(defaultValue = "100") int limit, @RequestParam(defaultValue = "0") int offset) {
    return service.sources(limit, offset);
  }

  @PostMapping("/sources")
  UUID source(@Valid @RequestBody SourceService.SourceInput body) {
    return service.source(null, body);
  }

  @PutMapping("/sources/{id}")
  UUID source(@PathVariable UUID id, @Valid @RequestBody SourceService.SourceInput body) {
    return service.source(id, body);
  }

  @PostMapping("/source-records")
  SourceService.RecordView record(@Valid @RequestBody SourceService.RecordInput body) {
    return service.record(body);
  }

  @PostMapping("/source-observations")
  SourceService.Observation observe(@Valid @RequestBody SourceService.ObservationInput body) {
    return service.observe(body);
  }

  @GetMapping("/source-records/{id}/observations")
  List<SourceService.Observation> observations(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.observations(id, limit, offset);
  }

  @PostMapping("/source-observations/{id}/reviews")
  UUID review(@PathVariable UUID id, @Valid @RequestBody SourceService.ReviewInput body) {
    return service.review(id, body);
  }

  @GetMapping("/source-observations/{id}/reviews")
  List<SourceService.Review> reviews(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.reviews(id, limit, offset);
  }
}
