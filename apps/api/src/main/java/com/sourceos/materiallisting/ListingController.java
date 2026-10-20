package com.sourceos.materiallisting;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class ListingController {
  private final ListingService service;

  ListingController(ListingService service) {
    this.service = service;
  }

  @io.swagger.v3.oas.annotations.media.Schema(name = "ListingBinding")
  public record Binding(@NotNull UUID sourceRecordId) {}

  @GetMapping("/materials/{id}/listings")
  List<ListingService.View> materialListings(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.list(id, null, limit, offset);
  }

  @GetMapping("/suppliers/{id}/material-listings")
  List<ListingService.View> sellerListings(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.list(null, id, limit, offset);
  }

  @GetMapping("/material-listings/{id}")
  ListingService.View read(@PathVariable UUID id) {
    return service.read(id);
  }

  @PostMapping("/admin/material-listings")
  ListingService.View create(@Valid @RequestBody ListingService.Input v) {
    return service.create(v);
  }

  @PutMapping("/admin/material-listings/{id}")
  ListingService.View update(@PathVariable UUID id, @Valid @RequestBody ListingService.Input v) {
    return service.update(id, v);
  }

  @PostMapping("/admin/material-listing-identities")
  ListingService.View resolve(@Valid @RequestBody ListingService.IdentityInput v) {
    return service.resolve(v);
  }

  @PostMapping("/admin/material-listings/{id}/external-records")
  void bind(@PathVariable UUID id, @Valid @RequestBody Binding v) {
    service.bind(id, v.sourceRecordId());
  }

  @PostMapping("/admin/material-listings/{id}/sources")
  void cite(@PathVariable UUID id, @Valid @RequestBody ListingService.Citation v) {
    service.cite(id, v);
  }

  @GetMapping("/admin/material-listings/{id}/sources")
  List<ListingService.CitationView> citations(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.citations(id, limit, offset);
  }
}
