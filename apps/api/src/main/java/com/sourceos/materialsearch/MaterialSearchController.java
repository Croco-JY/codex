package com.sourceos.materialsearch;

import com.sourceos.material.MaterialService;
import com.sourceos.shared.Keysets;
import java.util.UUID;
import org.springdoc.core.annotations.ParameterObject;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class MaterialSearchController {
  private final MaterialSearch service;

  MaterialSearchController(MaterialSearch service) {
    this.service = service;
  }

  @GetMapping("/materials")
  Keysets.Page<MaterialService.View> search(
      @ParameterObject @ModelAttribute MaterialSearch.Filters filters,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(required = false) String cursor) {
    return service.search(filters, limit, cursor);
  }

  @GetMapping("/suppliers/{id}/catalog-materials")
  Keysets.Page<MaterialService.View> catalog(
      @PathVariable UUID id,
      @ParameterObject @ModelAttribute MaterialSearch.Filters filters,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(required = false) String cursor) {
    return service.search(filters.withCatalogSupplier(id), limit, cursor);
  }
}
