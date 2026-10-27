package com.sourceos.patternqa;

import com.sourceos.shared.Keysets;
import com.sourceos.shared.ValidationRules;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.*;
import tools.jackson.core.*;
import tools.jackson.databind.*;
import tools.jackson.databind.annotation.JsonDeserialize;

public final class PatternQaModels {
  private PatternQaModels() {}

  public static final long MAX = 9007199254740991L;

  @Schema(name = "PatternQaOutcome", enumAsRef = true)
  public enum Outcome {
    OBSERVED,
    CHANGES_REQUESTED,
    HUMAN_REVIEWED
  }

  @Schema(name = "PatternQaEvidenceBasis", enumAsRef = true)
  public enum Basis {
    METADATA_ONLY,
    READY_ARTIFACT
  }

  @Schema(name = "PatternQaState", enumAsRef = true)
  public enum State {
    UNREVIEWED,
    OBSERVED,
    CHANGES_REQUESTED,
    HUMAN_REVIEWED
  }

  @Schema(
      name = "PatternQaCreateInput",
      requiredProperties = {
        "expectedLatestAssessmentNumber",
        "outcome",
        "evidenceBasis",
        "artifactId",
        "notes"
      },
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record Input(
      @Schema(minimum = "0", maximum = "9007199254740991")
          @JsonDeserialize(using = IntegerInput.class)
          Long expectedLatestAssessmentNumber,
      @JsonDeserialize(using = OutcomeInput.class) Outcome outcome,
      @JsonDeserialize(using = BasisInput.class) Basis evidenceBasis,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          @JsonDeserialize(using = UuidInput.class)
          UUID artifactId,
      @Schema(minLength = 1, maxLength = 2000) @JsonDeserialize(using = TextInput.class)
          String notes) {}

  @Schema(
      name = "PatternQaAssessmentSummary",
      requiredProperties = {
        "id",
        "patternRevisionId",
        "styleId",
        "assessmentNumber",
        "outcome",
        "evidenceBasis",
        "artifactId",
        "reviewedAt"
      })
  public record Summary(
      UUID id,
      UUID patternRevisionId,
      UUID styleId,
      @Schema(minimum = "1", maximum = "9007199254740991") long assessmentNumber,
      Outcome outcome,
      Basis evidenceBasis,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          UUID artifactId,
      Instant reviewedAt) {}

  @Schema(
      name = "PatternQaAssessmentView",
      requiredProperties = {
        "id",
        "patternRevisionId",
        "styleId",
        "assessmentNumber",
        "outcome",
        "evidenceBasis",
        "artifactId",
        "reviewedAt",
        "notes"
      })
  public record Assessment(
      UUID id,
      UUID patternRevisionId,
      UUID styleId,
      @Schema(minimum = "1", maximum = "9007199254740991") long assessmentNumber,
      Outcome outcome,
      Basis evidenceBasis,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          UUID artifactId,
      Instant reviewedAt,
      @Schema(minLength = 1, maxLength = 2000) String notes) {}

  @Schema(
      name = "PatternQaView",
      requiredProperties = {
        "patternId",
        "patternRevisionId",
        "styleId",
        "patternRevisionNumber",
        "state",
        "latestAssessment"
      })
  public record View(
      UUID patternId,
      UUID patternRevisionId,
      UUID styleId,
      @Schema(minimum = "1", maximum = "9007199254740991") long patternRevisionNumber,
      State state,
      Assessment latestAssessment) {}

  @Schema(
      name = "PatternQaAssessmentPage",
      requiredProperties = {"items", "limit", "nextMaxAssessmentNumber"})
  public record Page(
      List<Summary> items,
      @Schema(minimum = "1", maximum = "100") int limit,
      @Schema(
              types = {"integer", "null"},
              format = "int64",
              minimum = "1",
              maximum = "9007199254740991")
          Long nextMaxAssessmentNumber) {}

  static class IntegerInput extends ValueDeserializer<Long> {
    public Long deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_NUMBER_INT)) throw ValidationRules.bad("Integer required");
      long n = p.getLongValue();
      if (n < 0 || n > MAX) throw ValidationRules.bad("Invalid assessment head");
      return n;
    }
  }

  static class TextInput extends ValueDeserializer<String> {
    public String deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("Notes required");
      return p.getString();
    }
  }

  static class UuidInput extends ValueDeserializer<UUID> {
    public UUID deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("UUID required");
      return Keysets.uuid(p.getString());
    }
  }

  static class OutcomeInput extends ValueDeserializer<Outcome> {
    public Outcome deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("Outcome required");
      try {
        return Outcome.valueOf(p.getString());
      } catch (IllegalArgumentException e) {
        throw ValidationRules.bad("Invalid outcome");
      }
    }
  }

  static class BasisInput extends ValueDeserializer<Basis> {
    public Basis deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("Review basis required");
      try {
        return Basis.valueOf(p.getString());
      } catch (IllegalArgumentException e) {
        throw ValidationRules.bad("Invalid review basis");
      }
    }
  }
}
