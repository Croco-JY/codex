package com.sourceos.facility;

import jakarta.validation.Valid;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class FacilityController {
  private final FacilityService service;

  FacilityController(FacilityService service) {
    this.service = service;
  }

  public record Binding(@jakarta.validation.constraints.NotNull UUID sourceRecordId) {}

  @GetMapping("/facilities/{id}")
  FacilityService.View read(@PathVariable UUID id) {
    return service.read(id);
  }

  @GetMapping("/facilities/{id}/capabilities")
  List<FacilityService.CapabilityView> capabilities(@PathVariable UUID id) {
    return service.capabilities(id);
  }

  @PostMapping("/admin/facilities")
  FacilityService.View create(@Valid @RequestBody FacilityService.Input body) {
    return service.create(body);
  }

  @PutMapping("/admin/facilities/{id}")
  FacilityService.View update(
      @PathVariable UUID id, @Valid @RequestBody FacilityService.Input body) {
    return service.update(id, body);
  }

  @PostMapping("/admin/facility-identities")
  FacilityService.View resolve(@Valid @RequestBody FacilityService.IdentityInput body) {
    return service.resolveIdentity(body);
  }

  @PostMapping("/admin/facilities/{id}/external-records")
  void bind(@PathVariable UUID id, @Valid @RequestBody Binding body) {
    service.bindIdentity(id, body.sourceRecordId());
  }

  @PostMapping("/admin/facilities/{id}/sources")
  void cite(@PathVariable UUID id, @Valid @RequestBody FacilityService.Citation body) {
    service.citation(id, body);
  }

  @GetMapping("/admin/facilities/{id}/sources")
  List<Map<String, Object>> citations(@PathVariable UUID id) {
    return service.citations(id);
  }

  @PutMapping("/admin/facilities/{id}/capabilities/{capability}")
  void assign(
      @PathVariable UUID id,
      @PathVariable UUID capability,
      @Valid @RequestBody FacilityService.CapabilityInput body) {
    service.assign(id, capability, body);
  }
}
