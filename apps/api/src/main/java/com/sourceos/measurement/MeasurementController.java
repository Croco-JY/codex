package com.sourceos.measurement;

import com.sourceos.shared.RequestIds;
import io.swagger.v3.oas.annotations.*;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(
    "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/measurement-spec")
class MeasurementController {
  private final MeasurementService service;

  MeasurementController(MeasurementService service) {
    this.service = service;
  }

  @GetMapping
  @Operation(operationId = "readMeasurementSpec")
  MeasurementService.SpecView read(
      @PathVariable UUID organizationId, @PathVariable UUID projectId, @PathVariable UUID styleId) {
    return service.read(organizationId, projectId, styleId);
  }

  @PutMapping
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createMeasurementSpec")
  MeasurementService.SpecView create(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @Parameter(
              description =
                  "Required singleton create-only precondition: exactly one * with optional HTTP"
                      + " SP/HTAB")
          @RequestHeader(name = "If-None-Match", required = false)
          String ifNoneMatch,
      @RequestBody MeasurementService.CreateInput body,
      HttpServletRequest request) {
    return service.create(
        organizationId,
        projectId,
        styleId,
        body,
        Collections.list(request.getHeaders("If-None-Match")),
        RequestIds.get(request));
  }

  @GetMapping("/revisions")
  @Operation(operationId = "listMeasurementRevisions")
  MeasurementService.Page history(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestParam(defaultValue = "25")
          @Parameter(schema = @Schema(minimum = "1", maximum = "100"))
          int limit,
      @RequestParam(required = false)
          @Parameter(schema = @Schema(minimum = "1", maximum = "9007199254740991"))
          Long maxRevisionNumber) {
    return service.history(organizationId, projectId, styleId, limit, maxRevisionNumber);
  }

  @GetMapping("/revisions/{revisionId}")
  @Operation(operationId = "readMeasurementRevision")
  MeasurementService.RevisionView revision(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID revisionId) {
    return service.readRevision(organizationId, projectId, styleId, revisionId);
  }

  @PostMapping("/revisions")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createMeasurementRevision")
  MeasurementService.RevisionView createRevision(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestBody MeasurementService.RevisionInput body,
      HttpServletRequest request) {
    return service.createRevision(
        organizationId, projectId, styleId, body, RequestIds.get(request));
  }
}
