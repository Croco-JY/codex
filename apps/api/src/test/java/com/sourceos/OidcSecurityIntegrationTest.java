package com.sourceos;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class OidcSecurityIntegrationTest {
  @Container static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18.3");

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
    r.add(
        "source.storage-root", () -> System.getProperty("java.io.tmpdir") + "/source-oidc-storage");
  }

  @MockitoBean JwtDecoder decoder;
  @Autowired MockMvc mvc;

  @Test
  void developmentHeaderCannotAuthenticateProduction() throws Exception {
    mvc.perform(get("/api/identity").header("X-Dev-Subject", "forged-owner"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.requestId").exists());
  }

  @Test
  void validatedProviderIdentityIsAccepted() throws Exception {
    when(decoder.decode("provider-test-token"))
        .thenReturn(
            Jwt.withTokenValue("provider-test-token")
                .header("alg", "RS256")
                .issuer("https://issuer.example")
                .subject("provider-user")
                .build());
    mvc.perform(get("/api/identity").header("Authorization", "Bearer provider-test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.issuer").value("https://issuer.example"))
        .andExpect(jsonPath("$.subject").value("provider-user"));
  }

  @Test
  void invalidBearerReturnsCorrelatedProblem() throws Exception {
    when(decoder.decode("invalid")).thenThrow(new BadJwtException("Invalid token"));
    mvc.perform(get("/api/identity").header("Authorization", "Bearer invalid"))
        .andExpect(status().isUnauthorized())
        .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
        .andExpect(jsonPath("$.requestId").exists());
  }
}
