package com.sourceos.authorization;
import com.sourceos.identity.IdentityService;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
@Service
public class PlatformAuthorization {
 private final IdentityService identities; private final JdbcClient jdbc;
 public PlatformAuthorization(IdentityService identities,JdbcClient jdbc){this.identities=identities;this.jdbc=jdbc;}
 public void requireAdmin(){var actor=identities.current();
  boolean allowed=jdbc.sql("SELECT EXISTS(SELECT 1 FROM platform_role_assignment WHERE issuer=:issuer AND subject=:subject AND role='PLATFORM_ADMIN' AND status='ACTIVE')")
   .param("issuer",actor.issuer()).param("subject",actor.subject()).query(Boolean.class).single();
  if(!allowed)throw new AccessDeniedException("Platform administrator required");
 }
}
