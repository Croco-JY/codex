package com.sourceos.materialprice;

import com.sourceos.shared.*;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class PriceController {
  private final PriceService service;

  PriceController(PriceService service) {
    this.service = service;
  }

  @io.swagger.v3.oas.annotations.Operation(
      description =
          "Requires 1..100 same-provider observationIds. A matching Idempotency-Key retry appends"
              + " missing evidence without another price-created event.")
  @PostMapping("/admin/material-prices")
  PriceService.View create(
      @RequestHeader(value = "Idempotency-Key", required = false) UUID key,
      @Valid @RequestBody PriceService.Input v) {
    return service.create(v, key);
  }

  @io.swagger.v3.oas.annotations.Operation(
      description =
          "The required import observation is automatically included as evidence; nested"
              + " price.observationIds may be omitted or empty.")
  @PostMapping("/admin/material-price-imports")
  PriceService.View importPrice(@Valid @RequestBody PriceService.ImportInput v) {
    return service.importPrice(v);
  }

  @PostMapping("/admin/material-prices/{id}/close")
  PriceService.View close(@PathVariable UUID id, @Valid @RequestBody PriceService.CloseInput v) {
    return service.close(id, v);
  }

  @PostMapping("/admin/material-prices/{id}/sources")
  void cite(@PathVariable UUID id, @Valid @RequestBody PriceService.Evidence v) {
    service.cite(id, v);
  }

  @GetMapping("/admin/material-prices/{id}/sources")
  List<PriceService.EvidenceView> evidence(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.evidence(id, limit, offset);
  }

  @GetMapping("/material-listings/{id}/prices")
  Keysets.Page<PriceService.View> prices(
      @PathVariable UUID id,
      @RequestParam(required = false) UUID dataSourceId,
      @RequestParam(required = false) String currency,
      @RequestParam(required = false) MeasurementUnit priceUnit,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(required = false) String cursor) {
    return service.history(
        new PriceService.HistoryFilter(id, dataSourceId, currency, priceUnit), limit, cursor);
  }

  @GetMapping("/material-listings/{id}/effective-prices")
  PriceService.Resolution effective(
      @PathVariable UUID id,
      @RequestParam(required = false) UUID requestedVariantId,
      @RequestParam(required = false) BigDecimal requestedQuantity,
      @RequestParam(required = false) String currency,
      @RequestParam(required = false) MeasurementUnit priceUnit,
      @RequestParam(required = false) Instant asOf,
      @RequestParam(defaultValue = "false") boolean allowMaterialFallback,
      @RequestParam(required = false) UUID dataSourceId,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(required = false) String cursor) {
    return service.resolve(
        id,
        new PriceService.MatchRequest(
            requestedVariantId,
            requestedQuantity,
            currency,
            priceUnit,
            asOf,
            allowMaterialFallback,
            dataSourceId),
        limit,
        cursor);
  }
}
