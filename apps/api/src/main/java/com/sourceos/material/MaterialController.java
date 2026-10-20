package com.sourceos.material;

import com.sourceos.shared.WritePreconditions;
import io.swagger.v3.oas.annotations.Parameter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class MaterialController {
  private final MaterialService service;

  MaterialController(MaterialService service) {
    this.service = service;
  }

  @io.swagger.v3.oas.annotations.media.Schema(name = "MaterialBinding")
  public record Binding(@NotNull UUID sourceRecordId) {}

  @GetMapping("/materials/{id}")
  MaterialService.View read(@PathVariable UUID id) {
    return service.read(id);
  }

  @PostMapping("/admin/materials")
  MaterialService.View create(@Valid @RequestBody MaterialService.Input v) {
    return service.create(v);
  }

  @PutMapping("/admin/materials/{id}")
  MaterialService.View update(@PathVariable UUID id, @Valid @RequestBody MaterialService.Input v) {
    return service.update(id, v);
  }

  @PutMapping("/admin/materials/{id}/composition")
  MaterialService.View composition(
      @PathVariable UUID id, @Valid @RequestBody MaterialService.CompositionInput v) {
    return service.composition(id, v);
  }

  @GetMapping("/materials/{id}/variants")
  List<MaterialService.VariantView> variants(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.variants(id, limit, offset);
  }

  @GetMapping("/material-variants/{id}")
  MaterialService.VariantView variant(@PathVariable UUID id) {
    return service.variant(id);
  }

  @PostMapping("/admin/materials/{id}/variants")
  MaterialService.VariantView createVariant(
      @PathVariable UUID id, @Valid @RequestBody MaterialService.VariantInput v) {
    if (!id.equals(v.materialId()))
      throw com.sourceos.shared.ValidationRules.bad("Material ID mismatch");
    return service.createVariant(v);
  }

  @PutMapping("/admin/material-variants/{id}")
  MaterialService.VariantView updateVariant(
      @PathVariable UUID id, @Valid @RequestBody MaterialService.VariantInput v) {
    return service.updateVariant(id, v);
  }

  @PostMapping("/admin/material-identities")
  MaterialService.View resolve(@Valid @RequestBody MaterialService.IdentityInput v) {
    return service.resolve(v);
  }

  @PostMapping("/admin/material-variant-identities")
  MaterialService.VariantView resolve(@Valid @RequestBody MaterialService.VariantIdentityInput v) {
    return service.resolveVariant(v);
  }

  @PostMapping("/admin/materials/{id}/external-records")
  void bind(@PathVariable UUID id, @Valid @RequestBody Binding v) {
    service.bind(id, v.sourceRecordId(), false);
  }

  @PostMapping("/admin/material-variants/{id}/external-records")
  void bindVariant(@PathVariable UUID id, @Valid @RequestBody Binding v) {
    service.bind(id, v.sourceRecordId(), true);
  }

  @PostMapping("/admin/materials/{id}/sources")
  void cite(@PathVariable UUID id, @Valid @RequestBody MaterialService.Citation v) {
    service.cite(id, v);
  }

  @PostMapping("/admin/material-variants/{id}/sources")
  void citeVariant(@PathVariable UUID id, @Valid @RequestBody MaterialService.VariantCitation v) {
    service.citeVariant(id, v);
  }

  @GetMapping("/admin/materials/{id}/sources")
  List<MaterialService.CitationView> citations(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.citations(id, false, limit, offset);
  }

  @GetMapping("/admin/material-variants/{id}/sources")
  List<MaterialService.CitationView> variantCitations(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.citations(id, true, limit, offset);
  }

  @GetMapping("/fiber-types")
  List<MaterialService.Fiber> fibers(
      @RequestParam(defaultValue = "25") int limit, @RequestParam(defaultValue = "0") int offset) {
    return service.fibers(limit, offset);
  }

  @PostMapping("/admin/fiber-types")
  UUID fiber(@Valid @RequestBody MaterialService.FiberInput v) {
    return service.fiber(null, v);
  }

  @PutMapping("/admin/fiber-types/{id}")
  UUID fiber(@PathVariable UUID id, @Valid @RequestBody MaterialService.FiberInput v) {
    return service.fiber(id, v);
  }

  @GetMapping("/materials/{id}/fabric-spec")
  MaterialService.FabricView fabric(@PathVariable UUID id) {
    return service.fabric(id);
  }

  @PutMapping("/admin/materials/{id}/fabric-spec")
  MaterialService.FabricView fabric(
      @PathVariable UUID id,
      @Parameter(description = WritePreconditions.DESCRIPTION)
          @RequestHeader(name = "If-None-Match", required = false)
          String ifNoneMatch,
      @Valid @RequestBody MaterialService.FabricInput v) {
    return service.fabric(id, v, ifNoneMatch);
  }

  @GetMapping("/materials/{id}/leather-spec")
  MaterialService.LeatherView leather(@PathVariable UUID id) {
    return service.leather(id);
  }

  @PutMapping("/admin/materials/{id}/leather-spec")
  MaterialService.LeatherView leather(
      @PathVariable UUID id,
      @Parameter(description = WritePreconditions.DESCRIPTION)
          @RequestHeader(name = "If-None-Match", required = false)
          String ifNoneMatch,
      @Valid @RequestBody MaterialService.LeatherInput v) {
    return service.leather(id, v, ifNoneMatch);
  }
}
