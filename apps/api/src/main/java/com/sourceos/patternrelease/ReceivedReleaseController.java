package com.sourceos.patternrelease;

import com.sourceos.authorization.ReleaseAuthorization.*;
import com.sourceos.patternrelease.ReleaseModels.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.*;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@ReleaseProblems
@RequestMapping("/api/v1/organizations/{organizationId}/received-pattern-releases")
class ReceivedReleaseController {
  private final Authorizer authorizer;
  private final ReleaseDownloadFacade files;

  ReceivedReleaseController(Authorizer authorizer, ReleaseDownloadFacade files) {
    this.authorizer = authorizer;
    this.files = files;
  }

  private Received projection(Inspection inspected) {
    var c = inspected.candidate();
    if (!inspected.effectiveState().equals("ACTIVE"))
      return new InactiveReceived(
          c.id(),
          c.source(),
          c.recipient(),
          c.releasedAt(),
          c.expiresAt(),
          inspected.effectiveState());
    return new ActiveReceived(
        c.id(),
        c.source(),
        c.recipient(),
        c.revision(),
        c.revisionNumber(),
        c.artifact(),
        c.format(),
        c.displayName(),
        c.bytes(),
        c.purpose(),
        c.releasedAt(),
        c.expiresAt(),
        "ACTIVE");
  }

  @GetMapping
  @Operation(operationId = "listReceivedPatternReleases")
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
      responseCode = "200",
      description = "Authorized scoped response",
      useReturnTypeSchema = true)
  ReceivedPage inbox(
      @PathVariable UUID organizationId,
      @RequestParam(defaultValue = "25")
          @io.swagger.v3.oas.annotations.Parameter(
              schema = @Schema(type = "integer", format = "int32", minimum = "1", maximum = "100"))
          int limit,
      @RequestParam(required = false)
          @io.swagger.v3.oas.annotations.Parameter(schema = @Schema(maxLength = 2048))
          String cursor) {
    var page = authorizer.inbox(organizationId, limit, cursor);
    return new ReceivedPage(
        page.items().stream().map(this::projection).toList(), page.limit(), page.nextCursor());
  }

  @GetMapping("/{releaseId}")
  @Operation(operationId = "readReceivedPatternRelease")
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
      responseCode = "200",
      description = "Authorized scoped response",
      useReturnTypeSchema = true)
  Received read(@PathVariable UUID organizationId, @PathVariable UUID releaseId) {
    return projection(authorizer.inspectRecipient(organizationId, releaseId));
  }

  @GetMapping(value = "/{releaseId}/content", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
  @Operation(operationId = "downloadReceivedPatternRelease")
  @ApiResponse(
      responseCode = "200",
      description = "Private exact-byte attachment after completed final authorization",
      content =
          @Content(
              mediaType = MediaType.APPLICATION_OCTET_STREAM_VALUE,
              schema = @Schema(type = "string", format = "binary")))
  ResponseEntity<byte[]> content(@PathVariable UUID organizationId, @PathVariable UUID releaseId) {
    var result = files.download(organizationId, releaseId);
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(result.displayName(), StandardCharsets.UTF_8)
                .build()
                .toString())
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .contentLength(result.bytes().length)
        .body(result.bytes());
  }
}
