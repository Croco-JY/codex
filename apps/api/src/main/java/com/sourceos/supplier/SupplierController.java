package com.sourceos.supplier;

import jakarta.validation.Valid;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class SupplierController {
  private final SupplierService service;

  SupplierController(SupplierService service) {
    this.service = service;
  }

  public record Binding(@jakarta.validation.constraints.NotNull UUID sourceRecordId) {}

  @GetMapping("/suppliers/{id}")
  SupplierService.View read(@PathVariable UUID id) {
    return service.read(id);
  }

  @GetMapping("/suppliers/{id}/aliases")
  List<SupplierService.AliasView> aliases(@PathVariable UUID id) {
    return service.aliases(id);
  }

  @GetMapping("/suppliers/{id}/verification-events")
  List<SupplierService.VerificationEvent> events(@PathVariable UUID id) {
    return service.events(id);
  }

  @PostMapping("/admin/suppliers")
  SupplierService.View create(@Valid @RequestBody SupplierService.Input body) {
    return service.create(body);
  }

  @PutMapping("/admin/suppliers/{id}")
  SupplierService.View update(
      @PathVariable UUID id, @Valid @RequestBody SupplierService.Input body) {
    return service.update(id, body);
  }

  @PostMapping("/admin/supplier-identities")
  SupplierService.View resolve(@Valid @RequestBody SupplierService.IdentityInput body) {
    return service.resolveIdentity(body);
  }

  @PostMapping("/admin/suppliers/{id}/external-records")
  void bind(@PathVariable UUID id, @Valid @RequestBody Binding body) {
    service.bindIdentity(id, body.sourceRecordId());
  }

  @PostMapping("/admin/suppliers/{id}/aliases")
  UUID alias(@PathVariable UUID id, @Valid @RequestBody SupplierService.AliasInput body) {
    return service.alias(id, body);
  }

  @PostMapping("/admin/suppliers/{id}/verification-events")
  SupplierService.View verify(
      @PathVariable UUID id, @Valid @RequestBody SupplierService.VerificationInput body) {
    return service.verify(id, body);
  }

  @PostMapping("/admin/suppliers/{id}/sources")
  void cite(@PathVariable UUID id, @Valid @RequestBody SupplierService.Citation body) {
    service.citation(id, body);
  }

  @GetMapping("/admin/suppliers/{id}/sources")
  List<Map<String, Object>> citations(@PathVariable UUID id) {
    return service.citations(id);
  }
}
