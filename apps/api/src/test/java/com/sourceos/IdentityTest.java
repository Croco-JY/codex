package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.identity.*;
import org.junit.jupiter.api.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

class IdentityTest {
  @AfterEach
  void clear() {
    SecurityContextHolder.clearContext();
  }

  @Test
  void mapsValidatedOidcIssuerAndSubject() {
    Jwt jwt =
        Jwt.withTokenValue("test-only")
            .header("alg", "RS256")
            .issuer("https://issuer.example")
            .subject("external-user")
            .build();
    SecurityContextHolder.getContext()
        .setAuthentication(new JwtAuthenticationToken(jwt, java.util.List.of()));
    assertThat(new IdentityService().current())
        .isEqualTo(new Actor("https://issuer.example", "external-user"));
  }

  @Test
  void absentAuthenticationIsDenied() {
    assertThatThrownBy(() -> new IdentityService().current())
        .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
  }

  @Test
  void invalidIdentityIsRejected() {
    assertThatThrownBy(() -> new Actor("", "user")).isInstanceOf(IllegalArgumentException.class);
  }
}
