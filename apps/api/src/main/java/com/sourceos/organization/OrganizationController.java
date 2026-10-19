package com.sourceos.organization;

import com.sourceos.shared.RequestIds;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/organizations")
class OrganizationController {
  public record CreateOrganization(@NotBlank @Size(max = 160) String name) {}

  public record RenameOrganization(@NotBlank @Size(max = 160) String name, @Min(0) long version) {}

  private final OrganizationService service;

  OrganizationController(OrganizationService service) {
    this.service = service;
  }

  @GetMapping
  public List<OrganizationView> list() {
    return service.list();
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public OrganizationView create(
      @Valid @RequestBody CreateOrganization body, HttpServletRequest req) {
    return service.create(body.name(), RequestIds.get(req));
  }

  @GetMapping("/{id}")
  public OrganizationView read(@PathVariable UUID id) {
    return service.read(id);
  }

  @PatchMapping("/{id}")
  public OrganizationView rename(
      @PathVariable UUID id, @Valid @RequestBody RenameOrganization body, HttpServletRequest req) {
    return service.rename(id, body.name(), body.version(), RequestIds.get(req));
  }
}
