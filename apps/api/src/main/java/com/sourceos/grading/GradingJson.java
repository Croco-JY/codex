package com.sourceos.grading;

import com.sourceos.shared.ValidationRules;
import java.math.BigDecimal;
import tools.jackson.core.*;
import tools.jackson.databind.*;

final class GradingJson {
  private GradingJson() {}

  static class Text extends ValueDeserializer<String> {
    public String deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("Text required");
      return p.getString();
    }
  }

  static class Integer extends ValueDeserializer<Long> {
    public Long deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_NUMBER_INT)) throw ValidationRules.bad("Integer required");
      long value = p.getLongValue();
      if (value < 0 || value > GradingService.MAX) throw ValidationRules.bad("Invalid integer");
      return value;
    }
  }

  static class Decimal extends ValueDeserializer<BigDecimal> {
    public BigDecimal deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)
          || !p.getString().matches("-?[0-9]{1,15}(\\.[0-9]{1,4})?"))
        throw ValidationRules.bad("Exact decimal string required");
      return new BigDecimal(p.getString());
    }
  }

  static <T extends Enum<T>> T enumeration(JsonParser p, Class<T> type) {
    if (!p.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("Code required");
    try {
      return Enum.valueOf(type, p.getString());
    } catch (IllegalArgumentException invalid) {
      throw ValidationRules.bad("Invalid code");
    }
  }

  static class Status extends ValueDeserializer<GradingModels.Status> {
    public GradingModels.Status deserialize(JsonParser p, DeserializationContext c) {
      return enumeration(p, GradingModels.Status.class);
    }
  }

  static class Unit extends ValueDeserializer<GradingModels.Unit> {
    public GradingModels.Unit deserialize(JsonParser p, DeserializationContext c) {
      return enumeration(p, GradingModels.Unit.class);
    }
  }
}
