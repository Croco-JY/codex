package com.sourceos.patternqa;

import com.sourceos.patternqa.PatternQaModels.*;
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
    "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/patterns/{patternId}/revisions/{revisionId}/qa")
class PatternQaController {
  private final PatternQaService service;
  private final JsonMapper json;

  PatternQaController(PatternQaService service, JsonMapper json) {
    this.service = service;
    this.json =
        json.rebuild()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .build();
  }

  @GetMapping
  @Operation(operationId = "readPatternQa")
  View read(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId) {
    return service.read(organizationId, projectId, styleId, patternId, revisionId);
  }

  @GetMapping("/assessments")
  @Operation(operationId = "listPatternQaAssessments")
  Page history(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId,
      @RequestParam(defaultValue = "25")
          @Parameter(schema = @Schema(minimum = "1", maximum = "100"))
          int limit,
      @RequestParam(required = false)
          @Parameter(schema = @Schema(minimum = "0", maximum = "9007199254740991"))
          Long maxAssessmentNumber) {
    return service.history(
        organizationId, projectId, styleId, patternId, revisionId, limit, maxAssessmentNumber);
  }

  @PostMapping(value = "/assessments", consumes = MediaType.APPLICATION_JSON_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(
      operationId = "createPatternQaAssessment",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content =
                  @Content(
                      mediaType = MediaType.APPLICATION_JSON_VALUE,
                      schema = @Schema(implementation = Input.class))))
  Assessment create(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId,
      @RequestBody byte[] body,
      HttpServletRequest request) {
    Input input;
    try {
      input = json.readValue(body, Input.class);
    } catch (RuntimeException invalid) {
      throw ValidationRules.bad("Invalid QA JSON");
    }
    return service.create(
        organizationId, projectId, styleId, patternId, revisionId, input, RequestIds.get(request));
  }

  @GetMapping("/assessments/{assessmentId}")
  @Operation(operationId = "readPatternQaAssessment")
  Assessment exact(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId,
      @PathVariable UUID assessmentId) {
    return service.exact(organizationId, projectId, styleId, patternId, revisionId, assessmentId);
  }
}
