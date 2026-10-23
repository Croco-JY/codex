package com.sourceos.identity;

import static org.assertj.core.api.Assertions.*;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class CorsConfigurationTest {
  @org.junit.jupiter.api.Test
  void deleteIsAllowedOnlyForThePrivateSelectionUnlinkPath() {
    var source = new SecurityConfiguration().cors("https://frontend.example.test");
    for (String path :
        java.util.List.of(
            "/api/v1/organizations/A/projects/P/styles/S/material-selections/X",
            "/api/v1/materials/X")) {
      var request = new org.springframework.mock.web.MockHttpServletRequest("OPTIONS", path);
      request.setServletPath(path);
      var config = source.getCorsConfiguration(request);
      assertThat(config.getAllowedOrigins()).containsExactly("https://frontend.example.test");
      assertThat(config.checkHttpMethod(org.springframework.http.HttpMethod.DELETE) != null)
          .isEqualTo(path.contains("material-selections"));
      assertThat(config.getAllowedHeaders())
          .contains("Authorization", "X-Dev-Subject", "If-None-Match");
    }
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "*",
        "https://*.example.test",
        "https://frontend.example.test/path",
        "https://frontend.example.test/",
        "https://frontend.example.test/../",
        "https://frontend.example.test?query=value",
        "https://frontend.example.test#fragment",
        "https://user:password@frontend.example.test",
        "https://@frontend.example.test",
        "//frontend.example.test",
        "file:///tmp/app",
        "javascript:alert(1)",
        "not an origin",
        "https://frontend.example.test:65536"
      })
  void rejectsInvalidConfigurationWithoutRepairingOrEchoingIt(String origin) {
    assertThatThrownBy(() -> new SecurityConfiguration().cors(origin))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageNotContaining(origin);
  }
}
