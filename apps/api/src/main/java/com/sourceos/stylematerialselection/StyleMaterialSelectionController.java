package com.sourceos.stylematerialselection;

import com.sourceos.shared.RequestIds;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(
    "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/material-selections")
class StyleMaterialSelectionController {
  private final StyleMaterialSelectionService service;

  StyleMaterialSelectionController(StyleMaterialSelectionService service) {
    this.service = service;
  }

  @GetMapping
  @io.swagger.v3.oas.annotations.Operation(operationId = "listStyleMaterialSelections")
  StyleMaterialSelectionService.Page list(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.list(organizationId, projectId, styleId, limit, offset);
  }

  @PostMapping
  @io.swagger.v3.oas.annotations.Operation(operationId = "addStyleMaterialSelection")
  @ResponseStatus(HttpStatus.CREATED)
  StyleMaterialSelectionService.View add(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestBody @Valid StyleMaterialSelectionService.Input body,
      HttpServletRequest request) {
    return service.add(organizationId, projectId, styleId, body, RequestIds.get(request));
  }

  @DeleteMapping("/{selectionId}")
  @io.swagger.v3.oas.annotations.Operation(operationId = "removeStyleMaterialSelection")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  void remove(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID selectionId,
      HttpServletRequest request) {
    service.remove(organizationId, projectId, styleId, selectionId, RequestIds.get(request));
  }
}
