package com.sourceos.pattern;

import com.sourceos.shared.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.*;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import jakarta.servlet.http.Part;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

@RestController
@RequestMapping(
    "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/patterns/{patternId}")
class PatternArtifactController {
  @Schema(
      name = "PatternArtifactMultipart",
      requiredProperties = {"metadata", "file"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  record Multipart(
      PatternArtifactService.Input metadata,
      @Schema(type = "string", format = "binary") String file) {}

  private final PatternArtifactService service;
  private final JsonMapper json;

  PatternArtifactController(PatternArtifactService service, JsonMapper json) {
    this.service = service;
    this.json =
        json.rebuild()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();
  }

  @PostMapping(value = "/artifact-revisions", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(
      operationId = "createPatternArtifactRevision",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content =
                  @Content(
                      mediaType = MediaType.MULTIPART_FORM_DATA_VALUE,
                      schema = @Schema(implementation = Multipart.class))))
  PatternArtifactService.Result upload(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      MultipartHttpServletRequest request)
      throws Exception {
    var parts = request.getParts();
    if (parts.size() != 2
        || parts.stream().filter(p -> p.getName().equals("metadata")).count() != 1
        || parts.stream().filter(p -> p.getName().equals("file")).count() != 1)
      throw ValidationRules.bad("Exactly metadata and file required");
    Part metadata =
        parts.stream().filter(p -> p.getName().equals("metadata")).findFirst().orElseThrow();
    Part file = parts.stream().filter(p -> p.getName().equals("file")).findFirst().orElseThrow();
    try {
      var type =
          metadata.getContentType() == null
              ? null
              : MediaType.parseMediaType(metadata.getContentType());
      if (type == null
          || type.isWildcardType()
          || type.isWildcardSubtype()
          || !MediaType.APPLICATION_JSON.isCompatibleWith(type)
          || (type.getCharset() != null && !StandardCharsets.UTF_8.equals(type.getCharset())))
        throw ValidationRules.bad("Metadata must be UTF-8 application/json");
    } catch (IllegalArgumentException e) {
      throw ValidationRules.bad("Invalid metadata media type");
    }
    byte[] bytes;
    try (var stream = metadata.getInputStream()) {
      bytes = stream.readNBytes(16385);
    }
    if (bytes.length == 0 || bytes.length > 16384)
      throw ValidationRules.bad("Metadata must be 1..16384 bytes");
    PatternArtifactService.Input input;
    try {
      input = json.readValue(bytes, PatternArtifactService.Input.class);
    } catch (RuntimeException e) {
      throw ValidationRules.bad("Invalid artifact metadata JSON");
    }
    return service.upload(
        organizationId,
        projectId,
        styleId,
        patternId,
        input,
        file::getInputStream,
        RequestIds.get(request));
  }

  @GetMapping("/revisions/{revisionId}/artifact")
  @Operation(operationId = "readPatternArtifact")
  PatternArtifactService.View read(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId) {
    return service.read(organizationId, projectId, styleId, patternId, revisionId);
  }

  @GetMapping(
      value = "/revisions/{revisionId}/artifact/content",
      produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
  @Operation(operationId = "downloadPatternArtifact")
  @ApiResponse(
      responseCode = "200",
      description = "Private exact-byte attachment",
      content =
          @Content(
              mediaType = MediaType.APPLICATION_OCTET_STREAM_VALUE,
              schema = @Schema(type = "string", format = "binary")))
  ResponseEntity<byte[]> content(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID patternId,
      @PathVariable UUID revisionId) {
    var c = service.content(organizationId, projectId, styleId, patternId, revisionId);
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(c.metadata().displayName(), StandardCharsets.UTF_8)
                .build()
                .toString())
        .header("X-Content-Type-Options", "nosniff")
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .body(c.bytes());
  }
}
