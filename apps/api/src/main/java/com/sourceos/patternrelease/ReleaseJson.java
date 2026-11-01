package com.sourceos.patternrelease;

import com.sourceos.shared.Keysets;
import com.sourceos.shared.ValidationRules;
import java.math.BigInteger;
import java.util.*;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.*;
import tools.jackson.databind.json.JsonMapper;

/** Strict token validation: numbers are never coerced from strings or decimals. */
@Component
final class ReleaseJson {
  private final JsonMapper json;

  ReleaseJson(JsonMapper mapper) {
    json =
        mapper
            .rebuild()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();
  }

  private JsonNode object(byte[] body, Set<String> allowed, Set<String> required) {
    try {
      if (body == null || body.length > 16384) throw ValidationRules.bad("Invalid release JSON");
      JsonNode n = json.readTree(body);
      if (n == null || !n.isObject()) throw ValidationRules.bad("JSON object required");
      for (String key : n.propertyNames())
        if (!allowed.contains(key)) throw ValidationRules.bad("Unknown release field");
      for (String key : required)
        if (n.get(key) == null || n.get(key).isNull())
          throw ValidationRules.bad("Missing release field");
      return n;
    } catch (RuntimeException invalid) {
      throw ValidationRules.bad("Invalid release JSON");
    }
  }

  private String text(JsonNode n) {
    if (n == null || !n.isString()) throw ValidationRules.bad("Text required");
    return n.asString();
  }

  private long number(JsonNode n, long max) {
    if (n == null || !n.isIntegralNumber())
      throw ValidationRules.bad("Exact integer token required");
    var value = new BigInteger(n.toString());
    if (value.signum() < 0 || value.compareTo(BigInteger.valueOf(max)) > 0)
      throw ValidationRules.bad("Integer out of bounds");
    return value.longValueExact();
  }

  ReleaseModels.ConsentCreateInput consent(byte[] body) {
    var n = object(body, Set.of("sourceOrganizationId"), Set.of("sourceOrganizationId"));
    return new ReleaseModels.ConsentCreateInput(Keysets.uuid(text(n.get("sourceOrganizationId"))));
  }

  ReleaseModels.EventCommand event(byte[] body) {
    var n = object(body, Set.of("expectedLatestEventNumber"), Set.of("expectedLatestEventNumber"));
    return new ReleaseModels.EventCommand(
        number(n.get("expectedLatestEventNumber"), ReleaseModels.MAX));
  }

  ReleaseModels.CreateInput release(byte[] body) {
    var fields = Set.of("consentId", "expectedLatestConsentEventNumber", "purpose");
    var allowed = new HashSet<>(fields);
    allowed.add("accessDurationSeconds");
    var n = object(body, allowed, fields);
    int duration =
        n.get("accessDurationSeconds") == null
            ? 86400
            : (int) number(n.get("accessDurationSeconds"), 86400);
    if (duration < 1) throw ValidationRules.bad("Positive access duration required");
    return new ReleaseModels.CreateInput(
        Keysets.uuid(text(n.get("consentId"))),
        number(n.get("expectedLatestConsentEventNumber"), ReleaseModels.MAX),
        text(n.get("purpose")),
        duration);
  }
}
