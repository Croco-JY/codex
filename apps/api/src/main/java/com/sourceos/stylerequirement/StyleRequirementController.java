package com.sourceos.stylerequirement;

import com.sourceos.shared.RequestIds;
import com.sourceos.shared.WritePreconditions;
import io.swagger.v3.oas.annotations.*;
import io.swagger.v3.oas.annotations.media.*;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(
    "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/requirement")
class StyleRequirementController {
  private final StyleRequirementService service;

  StyleRequirementController(StyleRequirementService service) {
    this.service = service;
  }

  @GetMapping
  @Operation(operationId = "readStyleRequirement")
  StyleRequirementService.View read(
      @PathVariable UUID organizationId, @PathVariable UUID projectId, @PathVariable UUID styleId) {
    return service.read(organizationId, projectId, styleId);
  }

  @PutMapping
  @Operation(operationId = "writeStyleRequirement")
  @ApiResponse(
      responseCode = "200",
      description = "Existing Requirement replaced",
      content = @Content(schema = @Schema(implementation = StyleRequirementService.View.class)))
  @ApiResponse(
      responseCode = "201",
      description = "Requirement created, version 0",
      content = @Content(schema = @Schema(implementation = StyleRequirementService.View.class)))
  ResponseEntity<StyleRequirementService.View> write(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @Parameter(description = WritePreconditions.DESCRIPTION)
          @RequestHeader(name = "If-None-Match", required = false)
          String ifNoneMatch,
      @RequestBody StyleRequirementService.Input body,
      HttpServletRequest request) {
    var result =
        service.write(
            organizationId, projectId, styleId, body, ifNoneMatch, RequestIds.get(request));
    return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
        .body(result.view());
  }
}
