package com.sourceos.patternrelease;

import com.sourceos.authorization.ReleaseAuthorization.Authorizer;
import com.sourceos.patternrelease.ReleaseModels.*;
import com.sourceos.shared.RequestIds;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@ReleaseProblems
@RequestMapping(
    "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/patterns/{patternId}/revisions/{revisionId}/releases")
class PatternReleaseSourceController {
  private final PatternReleaseService service;
  private final ReleaseJson json;
  private final Authorizer authorizer;

  PatternReleaseSourceController(PatternReleaseService s, ReleaseJson j, Authorizer a) {
    service = s;
    json = j;
    authorizer = a;
  }

  private SourceView inspected(UUID org, SourceView view) {
    // The mutation/read service has returned through its transaction interceptor.
    // Reconstruct the complete current receipt in the fixed coherent policy snapshot.
    var inspected = authorizer.inspectSource(org, view.release().id());
    var c = inspected.candidate();
    var summary =
        new SourceSummary(
            c.id(),
            c.consent(),
            c.source(),
            c.recipient(),
            c.project(),
            c.style(),
            c.pattern(),
            c.revision(),
            c.revisionNumber(),
            c.artifact(),
            c.format(),
            c.displayName(),
            c.bytes(),
            c.purpose(),
            c.releasedAt(),
            c.expiresAt());
    return new SourceView(
        summary,
        c.eventNumber(),
        c.revoked() ? EventKind.REVOKED : EventKind.ACTIVATED,
        EffectiveState.valueOf(inspected.effectiveState()));
  }

  @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(
      operationId = "createPatternRelease",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content = @Content(schema = @Schema(implementation = CreateInput.class))))
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
      responseCode = "201",
      description = "Authorized scoped response",
      useReturnTypeSchema = true)
  SourceView create(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId,
      @RequestBody byte[] body,
      HttpServletRequest request) {
    return inspected(
        organizationId,
        service.create(
            organizationId,
            projectId,
            styleId,
            patternId,
            revisionId,
            json.release(body),
            RequestIds.get(request)));
  }

  @GetMapping
  @Operation(operationId = "listPatternReleases")
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
      responseCode = "200",
      description = "Authorized scoped response",
      useReturnTypeSchema = true)
  SourcePage list(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId,
      @RequestParam(defaultValue = "25")
          @io.swagger.v3.oas.annotations.Parameter(
              schema = @Schema(type = "integer", format = "int32", minimum = "1", maximum = "100"))
          int limit,
      @RequestParam(required = false)
          @io.swagger.v3.oas.annotations.Parameter(schema = @Schema(maxLength = 2048))
          String cursor) {
    return service.list(organizationId, projectId, styleId, patternId, revisionId, limit, cursor);
  }

  @GetMapping("/{releaseId}")
  @Operation(operationId = "readPatternRelease")
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
      responseCode = "200",
      description = "Authorized scoped response",
      useReturnTypeSchema = true)
  SourceView read(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId,
      @PathVariable UUID releaseId) {
    return inspected(
        organizationId,
        service.read(organizationId, projectId, styleId, patternId, revisionId, releaseId));
  }

  @GetMapping("/{releaseId}/events")
  @Operation(operationId = "listPatternReleaseEvents")
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
      responseCode = "200",
      description = "Authorized scoped response",
      useReturnTypeSchema = true)
  EventPage events(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId,
      @PathVariable UUID releaseId,
      @RequestParam(defaultValue = "25")
          @io.swagger.v3.oas.annotations.Parameter(
              schema = @Schema(type = "integer", format = "int32", minimum = "1", maximum = "100"))
          int limit,
      @RequestParam(required = false)
          @io.swagger.v3.oas.annotations.Parameter(
              schema =
                  @Schema(
                      type = "integer",
                      format = "int64",
                      minimum = "0",
                      maximum = "9007199254740991"))
          Long maxEventNumber) {
    return service.events(
        organizationId,
        projectId,
        styleId,
        patternId,
        revisionId,
        releaseId,
        limit,
        maxEventNumber);
  }

  @PostMapping(value = "/{releaseId}/revocations", consumes = MediaType.APPLICATION_JSON_VALUE)
  @Operation(
      operationId = "revokePatternRelease",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content = @Content(schema = @Schema(implementation = EventCommand.class))))
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
      responseCode = "200",
      description = "Authorized scoped response",
      useReturnTypeSchema = true)
  SourceView revoke(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId,
      @PathVariable UUID releaseId,
      @RequestBody byte[] body,
      HttpServletRequest request) {
    return inspected(
        organizationId,
        service.revoke(
            organizationId,
            projectId,
            styleId,
            patternId,
            revisionId,
            releaseId,
            json.event(body),
            RequestIds.get(request)));
  }
}
