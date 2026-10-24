package com.sourceos.project;

import com.sourceos.shared.RequestIds;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/organizations/{organizationId}/projects")
class ProjectController {
  private final ProjectService projects;

  ProjectController(ProjectService projects) {
    this.projects = projects;
  }

  @GetMapping
  @Operation(operationId = "listProjects")
  ProjectService.Page list(
      @PathVariable UUID organizationId,
      @Parameter(description = "Omit to include ACTIVE and ARCHIVED")
          @RequestParam(required = false)
          ProjectService.Status status,
      @Parameter(schema = @Schema(minimum = "1", maximum = "100"))
          @RequestParam(defaultValue = "25")
          int limit,
      @Parameter(schema = @Schema(minimum = "0", maximum = "100000"))
          @RequestParam(defaultValue = "0")
          int offset) {
    return projects.list(organizationId, status, limit, offset);
  }

  @PostMapping
  @Operation(operationId = "createProject")
  @ResponseStatus(HttpStatus.CREATED)
  ProjectService.View create(
      @PathVariable UUID organizationId,
      @RequestBody ProjectService.CreateInput body,
      HttpServletRequest request) {
    return projects.create(organizationId, body, RequestIds.get(request));
  }

  @GetMapping("/{projectId}")
  @Operation(operationId = "readProject")
  ProjectService.View read(@PathVariable UUID organizationId, @PathVariable UUID projectId) {
    return projects.read(organizationId, projectId);
  }

  @PutMapping("/{projectId}")
  @Operation(operationId = "updateProject")
  ProjectService.View update(
      @PathVariable UUID organizationId,
      @PathVariable UUID projectId,
      @RequestBody ProjectService.UpdateInput body,
      HttpServletRequest request) {
    return projects.update(organizationId, projectId, body, RequestIds.get(request));
  }
}
