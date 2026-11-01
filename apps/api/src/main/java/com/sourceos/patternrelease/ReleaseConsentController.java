package com.sourceos.patternrelease;

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
@RequestMapping("/api/v1/organizations/{organizationId}/release-consents")
class ReleaseConsentController {
  private final ReleaseConsentService service;
  private final ReleaseJson json;

  ReleaseConsentController(ReleaseConsentService s, ReleaseJson j) {
    service = s;
    json = j;
  }

  @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(
      operationId = "createPatternReleaseConsent",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content = @Content(schema = @Schema(implementation = ConsentCreateInput.class))))
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
      responseCode = "201",
      description = "Authorized scoped response",
      useReturnTypeSchema = true)
  ConsentView issue(
      @PathVariable UUID organizationId, @RequestBody byte[] body, HttpServletRequest request) {
    return service.issue(organizationId, json.consent(body), RequestIds.get(request));
  }

  @GetMapping
  @Operation(operationId = "listPatternReleaseConsents")
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
      responseCode = "200",
      description = "Authorized scoped response",
      useReturnTypeSchema = true)
  ConsentPage list(
      @PathVariable UUID organizationId,
      @RequestParam(defaultValue = "25")
          @io.swagger.v3.oas.annotations.Parameter(
              schema = @Schema(type = "integer", format = "int32", minimum = "1", maximum = "100"))
          int limit,
      @RequestParam(required = false)
          @io.swagger.v3.oas.annotations.Parameter(schema = @Schema(maxLength = 2048))
          String cursor) {
    return service.list(organizationId, limit, cursor);
  }

  @GetMapping("/{consentId}")
  @Operation(operationId = "readPatternReleaseConsent")
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
      responseCode = "200",
      description = "Authorized scoped response",
      useReturnTypeSchema = true)
  ConsentView read(@PathVariable UUID organizationId, @PathVariable UUID consentId) {
    return service.read(organizationId, consentId);
  }

  @PostMapping(value = "/{consentId}/withdrawals", consumes = MediaType.APPLICATION_JSON_VALUE)
  @Operation(
      operationId = "withdrawPatternReleaseConsent",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content = @Content(schema = @Schema(implementation = EventCommand.class))))
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
      responseCode = "200",
      description = "Authorized scoped response",
      useReturnTypeSchema = true)
  ConsentView withdraw(
      @PathVariable UUID organizationId,
      @PathVariable UUID consentId,
      @RequestBody byte[] body,
      HttpServletRequest request) {
    return service.withdraw(organizationId, consentId, json.event(body), RequestIds.get(request));
  }
}
