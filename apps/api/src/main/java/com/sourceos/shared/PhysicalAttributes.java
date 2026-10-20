package com.sourceos.shared;

import java.util.*;

public final class PhysicalAttributes {
  private PhysicalAttributes() {}

  private static final Set<String> KEYS =
      Set.of(
          "abrasionCycles",
          "pillingGrade",
          "careInstruction",
          "testMethod",
          "finishCode",
          "textureCode",
          "size",
          "lengthMm",
          "patternCode");

  public static String json(Map<String, Object> input) {
    if (input == null) return null;
    if (input.size() > 16) throw ValidationRules.bad("Too many physical attributes");
    input.forEach(
        (k, v) -> {
          if (!KEYS.contains(k)
              || v == null
              || !(v instanceof String || v instanceof Number || v instanceof Boolean))
            throw ValidationRules.bad("Unsupported physical attribute");
          if (v instanceof String s) {
            if (s.length() > 255) throw ValidationRules.bad("Physical attribute too long");
            ValidationRules.notes(s);
          }
        });
    String json = new tools.jackson.databind.ObjectMapper().writeValueAsString(input);
    if (json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 8192)
      throw ValidationRules.bad("Physical attributes too large");
    return json;
  }

  @SuppressWarnings("unchecked")
  public static Map<String, Object> read(String json) {
    return json == null
        ? null
        : new tools.jackson.databind.ObjectMapper().readValue(json, Map.class);
  }
}
