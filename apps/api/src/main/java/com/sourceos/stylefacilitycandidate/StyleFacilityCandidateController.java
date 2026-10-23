package com.sourceos.stylefacilitycandidate;

import com.sourceos.shared.RequestIds;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(
    "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/facility-candidates")
class StyleFacilityCandidateController {
  private final StyleFacilityCandidateService service;

  StyleFacilityCandidateController(StyleFacilityCandidateService service) {
    this.service = service;
  }

  @GetMapping
  @io.swagger.v3.oas.annotations.Operation(operationId = "listStyleFacilityCandidates")
  StyleFacilityCandidateService.Page list(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return service.list(organizationId, projectId, styleId, limit, offset);
  }

  @PostMapping
  @io.swagger.v3.oas.annotations.Operation(operationId = "addStyleFacilityCandidate")
  @ResponseStatus(HttpStatus.CREATED)
  StyleFacilityCandidateService.View add(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestBody @Valid StyleFacilityCandidateService.Input body,
      HttpServletRequest request) {
    return service.add(organizationId, projectId, styleId, body, RequestIds.get(request));
  }

  @DeleteMapping("/{candidateId}")
  @io.swagger.v3.oas.annotations.Operation(operationId = "removeStyleFacilityCandidate")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  void remove(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID candidateId,
      HttpServletRequest request) {
    service.remove(organizationId, projectId, styleId, candidateId, RequestIds.get(request));
  }
}
