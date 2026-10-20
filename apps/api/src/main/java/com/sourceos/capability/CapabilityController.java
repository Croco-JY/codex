package com.sourceos.capability;

import jakarta.validation.Valid;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class CapabilityController {
  private final CapabilityService service;

  CapabilityController(CapabilityService service) {
    this.service = service;
  }

  @GetMapping("/capabilities")
  List<CapabilityService.View> list(
      @RequestParam(defaultValue = "100") int limit, @RequestParam(defaultValue = "0") int offset) {
    return service.list(limit, offset);
  }

  @PostMapping("/admin/capabilities")
  UUID create(@Valid @RequestBody CapabilityService.Input body) {
    return service.save(null, body);
  }

  @PutMapping("/admin/capabilities/{id}")
  UUID update(@PathVariable UUID id, @Valid @RequestBody CapabilityService.Input body) {
    return service.save(id, body);
  }
}
