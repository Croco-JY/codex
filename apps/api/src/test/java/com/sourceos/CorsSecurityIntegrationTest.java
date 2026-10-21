package com.sourceos;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

@TestPropertySource(properties = "source.cors-origins=https://frontend.example.test")
class CorsSecurityIntegrationTest extends SupplyIntegrationSupport {
  static final String ALLOWED = "https://frontend.example.test";
  static final String EVIL = "https://evil.example.test";

  @Test
  void configuredOriginCanSendTheExplicitCreateOnlyPrecondition() throws Exception {
    mvc.perform(
            options(
                    "/api/v1/admin/facilities/00000000-0000-4000-8000-000000000001/capabilities/00000000-0000-4000-8000-000000000002")
                .header("Origin", ALLOWED)
                .header("Access-Control-Request-Method", "PUT")
                .header(
                    "Access-Control-Request-Headers", "Content-Type,Authorization,If-None-Match"))
        .andExpect(status().isOk())
        .andExpect(header().string("Access-Control-Allow-Origin", ALLOWED))
        .andExpect(header().string("Access-Control-Allow-Headers", containsString("If-None-Match")))
        .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
  }

  @Test
  void configuredPreflightNeedsNoIdentityAndKeepsExplicitPolicy() throws Exception {
    mvc.perform(
            options("/api/identity")
                .header("Origin", ALLOWED)
                .header("Access-Control-Request-Method", "GET")
                .header(
                    "Access-Control-Request-Headers", "Authorization,X-Request-ID,X-Dev-Subject"))
        .andExpect(status().isOk())
        .andExpect(header().string("Access-Control-Allow-Origin", ALLOWED))
        .andExpect(header().string("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,OPTIONS"))
        .andExpect(header().string("Access-Control-Allow-Headers", containsString("Authorization")))
        .andExpect(header().string("Access-Control-Allow-Headers", containsString("X-Request-ID")))
        .andExpect(header().string("Access-Control-Allow-Headers", containsString("X-Dev-Subject")))
        .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
  }

  @Test
  void unlistedOriginPreflightIsNotGranted() throws Exception {
    mvc.perform(
            options("/api/identity")
                .header("Origin", EVIL)
                .header("Access-Control-Request-Method", "GET"))
        .andExpect(status().isForbidden())
        .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
  }

  @Test
  void allowedOriginStillNeedsAuthenticationForActualProtectedData() throws Exception {
    mvc.perform(get("/api/identity").header("Origin", ALLOWED))
        .andExpect(status().isUnauthorized())
        .andExpect(header().string("Access-Control-Allow-Origin", ALLOWED))
        .andExpect(header().string("Access-Control-Expose-Headers", "X-Request-ID"));
  }

  @Test
  void authenticatedAllowedOriginGetsIdentityAndVisibleRequestReference() throws Exception {
    mvc.perform(
            get("/api/identity")
                .header("Origin", ALLOWED)
                .header("X-Dev-Subject", "synthetic-cors-actor")
                .header("X-Request-ID", "cors-reference"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.subject").value("synthetic-cors-actor"))
        .andExpect(header().string("Access-Control-Allow-Origin", ALLOWED))
        .andExpect(header().string("Access-Control-Expose-Headers", "X-Request-ID"))
        .andExpect(header().string("X-Request-ID", "cors-reference"))
        .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
  }

  @Test
  void identityDoesNotGrantAccessToAnUnlistedOrigin() throws Exception {
    mvc.perform(
            get("/api/identity")
                .header("Origin", EVIL)
                .header("X-Dev-Subject", "synthetic-cors-actor"))
        .andExpect(status().isForbidden())
        .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
  }

  @Test
  void unlistedMethodIsNotAddedByWiringTheExistingPolicy() throws Exception {
    mvc.perform(
            options("/api/identity")
                .header("Origin", ALLOWED)
                .header("Access-Control-Request-Method", "DELETE"))
        .andExpect(status().isForbidden())
        .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
  }

  @Test
  void unlistedHeaderIsNotAddedByWiringTheExistingPolicy() throws Exception {
    mvc.perform(
            options("/api/identity")
                .header("Origin", ALLOWED)
                .header("Access-Control-Request-Method", "GET")
                .header("Access-Control-Request-Headers", "X-Unlisted-Header"))
        .andExpect(status().isForbidden())
        .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
  }
}
