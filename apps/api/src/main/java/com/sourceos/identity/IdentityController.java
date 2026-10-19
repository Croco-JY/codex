package com.sourceos.identity;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/identity")
class IdentityController {
  private final IdentityService identities;

  IdentityController(IdentityService identities) {
    this.identities = identities;
  }

  @GetMapping
  public Actor identity() {
    return identities.current();
  }
}
