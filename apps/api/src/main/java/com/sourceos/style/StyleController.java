package com.sourceos.style;

import com.sourceos.shared.RequestIds;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/organizations/{organizationId}/projects/{projectId}/styles")
class StyleController {
  private final StyleService styles;

  StyleController(StyleService styles) {
    this.styles = styles;
  }

  @GetMapping
  @Operation(operationId = "listProjectStyles")
  StyleService.Page list(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @Parameter(description = "Omit to include ACTIVE and ARCHIVED")
          @RequestParam(required = false)
          StyleService.Status status,
      @Parameter(schema = @Schema(minimum = "1", maximum = "100"))
          @RequestParam(defaultValue = "25")
          int limit,
      @Parameter(schema = @Schema(minimum = "0", maximum = "100000"))
          @RequestParam(defaultValue = "0")
          int offset) {
    return styles.list(organizationId, projectId, status, limit, offset);
  }

  @PostMapping
  @Operation(operationId = "createStyle")
  @ResponseStatus(HttpStatus.CREATED)
  StyleService.View create(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @RequestBody StyleService.CreateInput body,
      HttpServletRequest request) {
    return styles.create(organizationId, projectId, body, RequestIds.get(request));
  }

  @GetMapping("/{styleId}")
  @Operation(operationId = "readStyle")
  StyleService.View read(
      @PathVariable UUID organizationId, @PathVariable UUID projectId, @PathVariable UUID styleId) {
    return styles.read(organizationId, projectId, styleId);
  }

  @PutMapping("/{styleId}")
  @Operation(operationId = "updateStyle")
  StyleService.View update(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @PathVariable UUID styleId,
      @RequestBody StyleService.UpdateInput body,
      HttpServletRequest request) {
    return styles.update(organizationId, projectId, styleId, body, RequestIds.get(request));
  }
}
