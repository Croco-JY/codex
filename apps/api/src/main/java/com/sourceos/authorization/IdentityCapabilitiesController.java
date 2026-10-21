package com.sourceos.authorization;

import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class IdentityCapabilitiesController {
  private final PlatformAuthorization authorization;

  IdentityCapabilitiesController(PlatformAuthorization authorization) {
    this.authorization = authorization;
  }

  @Schema(name = "IdentityCapabilities")
  public record Capabilities(boolean platformAdmin) {}

  @GetMapping("/api/identity/capabilities")
  Capabilities capabilities() {
    return new Capabilities(authorization.isAdmin());
  }
}
