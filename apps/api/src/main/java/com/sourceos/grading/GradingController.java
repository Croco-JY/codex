package com.sourceos.grading;

import com.sourceos.grading.GradingModels.*;
import com.sourceos.shared.RequestIds;
import com.sourceos.shared.ValidationRules;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

@RestController
@RequestMapping(
    "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/grade-rule-sets")
class GradingController {
  private final GradingService service;
  private final JsonMapper json;

  GradingController(GradingService service, JsonMapper json) {
    this.service = service;
    this.json =
        json.rebuild()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();
  }

  private <T> T input(byte[] bytes, Class<T> type) {
    try {
      T value = json.readValue(bytes, type);
      if (value == null) throw ValidationRules.bad("Grading snapshot required");
      return value;
    } catch (RuntimeException invalid) {
      throw ValidationRules.bad("Invalid grading JSON");
    }
  }

  @GetMapping
  @Operation(operationId = "listGradeRuleSets")
  Page list(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestParam(defaultValue = "ACTIVE") Filter status,
      @RequestParam(defaultValue = "25")
          @Parameter(schema = @Schema(minimum = "1", maximum = "100"))
          int limit,
      @RequestParam(required = false) String cursor) {
    return service.list(organizationId, projectId, styleId, status, limit, cursor);
  }

  @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(
      operationId = "createGradeRuleSet",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content =
                  @Content(
                      mediaType = MediaType.APPLICATION_JSON_VALUE,
                      schema = @Schema(implementation = CreateInput.class))))
  View create(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestBody byte[] body,
      HttpServletRequest request) {
    return service.create(
        organizationId,
        projectId,
        styleId,
        input(body, CreateInput.class),
        RequestIds.get(request));
  }

  @GetMapping("/{gradeRuleSetId}")
  @Operation(operationId = "readGradeRuleSet")
  View read(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID gradeRuleSetId) {
    return service.read(organizationId, projectId, styleId, gradeRuleSetId);
  }

  @PutMapping(value = "/{gradeRuleSetId}", consumes = MediaType.APPLICATION_JSON_VALUE)
  @Operation(
      operationId = "updateGradeRuleSetLifecycle",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content =
                  @Content(
                      mediaType = MediaType.APPLICATION_JSON_VALUE,
                      schema = @Schema(implementation = LifecycleInput.class))))
  LifecycleView lifecycle(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID gradeRuleSetId,
      @RequestBody byte[] body,
      HttpServletRequest request) {
    return service.lifecycle(
        organizationId,
        projectId,
        styleId,
        gradeRuleSetId,
        input(body, LifecycleInput.class),
        RequestIds.get(request));
  }

  @GetMapping("/{gradeRuleSetId}/revisions")
  @Operation(operationId = "listGradeRuleSetRevisions")
  RevisionPage history(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID gradeRuleSetId,
      @RequestParam(defaultValue = "25")
          @Parameter(schema = @Schema(minimum = "1", maximum = "100"))
          int limit,
      @RequestParam(required = false)
          @Parameter(schema = @Schema(minimum = "1", maximum = "9007199254740991"))
          Long maxRevisionNumber) {
    return service.history(
        organizationId, projectId, styleId, gradeRuleSetId, limit, maxRevisionNumber);
  }

  @PostMapping(value = "/{gradeRuleSetId}/revisions", consumes = MediaType.APPLICATION_JSON_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(
      operationId = "createGradeRuleSetRevision",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content =
                  @Content(
                      mediaType = MediaType.APPLICATION_JSON_VALUE,
                      schema = @Schema(implementation = RevisionInput.class))))
  RevisionView revision(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID gradeRuleSetId,
      @RequestBody byte[] body,
      HttpServletRequest request) {
    return service.createRevision(
        organizationId,
        projectId,
        styleId,
        gradeRuleSetId,
        input(body, RevisionInput.class),
        RequestIds.get(request));
  }

  @GetMapping("/{gradeRuleSetId}/revisions/{revisionId}")
  @Operation(operationId = "readGradeRuleSetRevision")
  RevisionView exact(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID gradeRuleSetId,
      @PathVariable UUID revisionId) {
    return service.readRevision(organizationId, projectId, styleId, gradeRuleSetId, revisionId);
  }
}
