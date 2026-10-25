package com.sourceos.pattern;

import com.sourceos.shared.RequestIds;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(
    "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/patterns")
class PatternController {
  private final PatternService service;

  PatternController(PatternService service) {
    this.service = service;
  }

  @GetMapping
  @Operation(operationId = "listPatterns")
  PatternService.Page list(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestParam(defaultValue = "ACTIVE") PatternService.Filter status,
      @RequestParam(defaultValue = "25")
          @Parameter(schema = @Schema(minimum = "1", maximum = "100"))
          int limit,
      @RequestParam(required = false) String cursor) {
    return service.list(organizationId, projectId, styleId, status, limit, cursor);
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createPattern")
  PatternService.View create(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestBody PatternService.CreateInput body,
      HttpServletRequest request) {
    return service.create(organizationId, projectId, styleId, body, RequestIds.get(request));
  }

  @GetMapping("/{patternId}")
  @Operation(operationId = "readPattern")
  PatternService.View read(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId) {
    return service.read(organizationId, projectId, styleId, patternId);
  }

  @PutMapping("/{patternId}")
  @Operation(operationId = "updatePatternLifecycle")
  PatternService.View lifecycle(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @RequestBody PatternService.LifecycleInput body,
      HttpServletRequest request) {
    return service.lifecycle(
        organizationId, projectId, styleId, patternId, body, RequestIds.get(request));
  }

  @GetMapping("/{patternId}/revisions")
  @Operation(operationId = "listPatternRevisions")
  PatternService.RevisionPage history(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @RequestParam(defaultValue = "25")
          @Parameter(schema = @Schema(minimum = "1", maximum = "100"))
          int limit,
      @RequestParam(required = false)
          @Parameter(schema = @Schema(minimum = "1", maximum = "9007199254740991"))
          Long maxRevisionNumber) {
    return service.history(organizationId, projectId, styleId, patternId, limit, maxRevisionNumber);
  }

  @PostMapping("/{patternId}/revisions")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createPatternRevision")
  PatternService.RevisionView revision(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @RequestBody PatternService.RevisionInput body,
      HttpServletRequest request) {
    return service.createRevision(
        organizationId, projectId, styleId, patternId, body, RequestIds.get(request));
  }

  @GetMapping("/{patternId}/revisions/{revisionId}")
  @Operation(operationId = "readPatternRevision")
  PatternService.RevisionView exact(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId) {
    return service.readRevision(organizationId, projectId, styleId, patternId, revisionId);
  }
}
