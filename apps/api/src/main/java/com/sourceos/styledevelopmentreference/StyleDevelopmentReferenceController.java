package com.sourceos.styledevelopmentreference;

import com.sourceos.file.AuthorizedStorage;
import com.sourceos.shared.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.*;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.*;
import tools.jackson.core.*;
import tools.jackson.databind.*;
import tools.jackson.databind.annotation.JsonDeserialize;

@RestController
@RequestMapping(
    "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/development-references")
class StyleDevelopmentReferenceController {
  @Schema(
      name = "StyleDevelopmentReferenceDetachInput",
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
      requiredProperties = "version")
  record DetachInput(
      @NotNull
          @Schema(minimum = "0", maximum = "9007199254740991")
          @JsonDeserialize(using = VersionInput.class)
          Long version) {}

  static class VersionInput extends ValueDeserializer<Long> {
    @Override
    public Long deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_NUMBER_INT))
        throw ValidationRules.bad("Integer version required");
      long v = p.getLongValue();
      if (v < 0 || v > 9007199254740991L) throw ValidationRules.bad("Invalid version");
      return v;
    }
  }

  @Schema(
      name = "StyleDevelopmentReferenceUpload",
      requiredProperties = {"displayName", "file"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  record UploadInput(String displayName, @Schema(type = "string", format = "binary") String file) {}

  private final StyleDevelopmentReferenceService service;

  StyleDevelopmentReferenceController(StyleDevelopmentReferenceService service) {
    this.service = service;
  }

  @GetMapping
  @Operation(operationId = "listStyleDevelopmentReferences")
  StyleDevelopmentReferenceService.Page list(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestParam(required = false) StyleDevelopmentReferenceService.State state,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(defaultValue = "0") int offset,
      HttpServletRequest request) {
    var supplied = request.getParameterValues("state");
    if (supplied != null
        && (supplied.length != 1 || state == null || !supplied[0].equals(state.name())))
      throw ValidationRules.bad("One exact state filter required");
    return service.list(organizationId, projectId, styleId, state, limit, offset);
  }

  @GetMapping("/{referenceId}")
  @Operation(operationId = "readStyleDevelopmentReference")
  StyleDevelopmentReferenceService.View read(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID referenceId) {
    return service.read(organizationId, projectId, styleId, referenceId);
  }

  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(
      operationId = "uploadStyleDevelopmentReference",
      requestBody =
          @io.swagger.v3.oas.annotations.parameters.RequestBody(
              required = true,
              content =
                  @Content(
                      mediaType = MediaType.MULTIPART_FORM_DATA_VALUE,
                      schema = @Schema(implementation = UploadInput.class))))
  StyleDevelopmentReferenceService.View upload(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestPart("displayName") String displayName,
      @RequestPart("file") MultipartFile file,
      MultipartHttpServletRequest request)
      throws Exception {
    var parts = request.getParts();
    if (parts.size() != 2
        || parts.stream().filter(p -> p.getName().equals("displayName")).count() != 1
        || parts.stream().filter(p -> p.getName().equals("file")).count() != 1)
      throw ValidationRules.bad("Exactly displayName and file required");
    byte[] bytes;
    try (var input = file.getInputStream()) {
      bytes = input.readNBytes(AuthorizedStorage.MAX_BYTES + 1);
    }
    return service.upload(
        organizationId, projectId, styleId, displayName, bytes, RequestIds.get(request));
  }

  @PostMapping("/{referenceId}/detach")
  @Operation(operationId = "detachStyleDevelopmentReference")
  StyleDevelopmentReferenceService.View detach(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID referenceId,
      @RequestBody @Valid DetachInput input,
      HttpServletRequest request) {
    return service.detach(
        organizationId, projectId, styleId, referenceId, input.version(), RequestIds.get(request));
  }

  @GetMapping(value = "/{referenceId}/content", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
  @Operation(operationId = "downloadStyleDevelopmentReference")
  @ApiResponse(
      responseCode = "200",
      description = "Private attachment",
      content =
          @Content(
              mediaType = MediaType.APPLICATION_OCTET_STREAM_VALUE,
              schema = @Schema(type = "string", format = "binary")))
  ResponseEntity<byte[]> content(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @PathVariable UUID referenceId,
      HttpServletRequest request)
      throws IOException {
    var content =
        service.content(organizationId, projectId, styleId, referenceId, RequestIds.get(request));
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(content.metadata().displayName(), StandardCharsets.UTF_8)
                .build()
                .toString())
        .header("X-Content-Type-Options", "nosniff")
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .body(content.bytes());
  }
}
