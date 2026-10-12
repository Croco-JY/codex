package com.sourceos.identity;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

@Service
public class IdentityService {
  public Actor current() {
    var auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth == null || !auth.isAuthenticated())
      throw new AccessDeniedException("Authentication required");
    if (auth.getPrincipal() instanceof Actor actor) return actor;
    if (auth.getPrincipal() instanceof Jwt jwt)
      return new Actor(jwt.getIssuer().toString(), jwt.getSubject());
    throw new AccessDeniedException("Unsupported identity");
  }
}
