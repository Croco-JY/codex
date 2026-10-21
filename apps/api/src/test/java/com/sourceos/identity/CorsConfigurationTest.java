package com.sourceos.identity;

import static org.assertj.core.api.Assertions.*;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class CorsConfigurationTest {
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
