package com.sourceos.materialinventory;

import com.sourceos.shared.*;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class InventoryController {
  private final InventoryService service;

  InventoryController(InventoryService service) {
    this.service = service;
  }

  @PostMapping("/admin/material-inventory-snapshots")
  InventoryService.View create(@Valid @RequestBody InventoryService.Input v) {
    return service.create(v);
  }

  @GetMapping({"/material-listings/{id}/inventory-snapshots", "/material-listings/{id}/inventory"})
  Keysets.Page<InventoryService.View> read(
      @PathVariable UUID id,
      @RequestParam(required = false) UUID variantId,
      @RequestParam(required = false) UUID facilityId,
      @RequestParam(required = false) MeasurementUnit unit,
      @RequestParam(required = false) InventoryService.Mode captureMode,
      @RequestParam(required = false) Instant asOf,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(required = false) String cursor,
      jakarta.servlet.http.HttpServletRequest request) {
    return service.list(
        new InventoryService.Filter(
            id,
            variantId,
            facilityId,
            unit,
            captureMode,
            asOf,
            request.getRequestURI().endsWith("/inventory")),
        limit,
        cursor);
  }
}
