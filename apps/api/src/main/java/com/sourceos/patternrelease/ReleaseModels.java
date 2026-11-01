package com.sourceos.patternrelease;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.*;

public final class ReleaseModels {
  private ReleaseModels() {}

  public static final long MAX = 9007199254740991L;

  @Schema(name = "ReleaseConsentState", enumAsRef = true)
  public enum ConsentState {
    ISSUED,
    CONSUMED,
    WITHDRAWN,
    EXPIRED
  }

  @Schema(name = "PatternReleaseEffectiveState", enumAsRef = true)
  public enum EffectiveState {
    ACTIVE,
    EXPIRED,
    REVOKED,
    WITHDRAWN,
    UNAVAILABLE
  }

  @Schema(name = "PatternReleaseEventKind", enumAsRef = true)
  public enum EventKind {
    ACTIVATED,
    REVOKED
  }

  @Schema(
      name = "ReleaseConsentCreateInput",
      requiredProperties = {"sourceOrganizationId"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record ConsentCreateInput(UUID sourceOrganizationId) {}

  @Schema(
      name = "ReleaseEventCommand",
      requiredProperties = {"expectedLatestEventNumber"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record EventCommand(
      @Schema(minimum = "0", maximum = "9007199254740991") Long expectedLatestEventNumber) {}

  @Schema(
      name = "PatternReleaseCreateInput",
      requiredProperties = {"consentId", "expectedLatestConsentEventNumber", "purpose"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record CreateInput(
      UUID consentId,
      @Schema(minimum = "0", maximum = "9007199254740991") Long expectedLatestConsentEventNumber,
      @Schema(minLength = 1, maxLength = 1000) String purpose,
      @Schema(minimum = "1", maximum = "86400", defaultValue = "86400")
          Integer accessDurationSeconds) {}

  @Schema(
      name = "ReleaseConsentView",
      requiredProperties = {
        "id",
        "recipientOrganizationId",
        "sourceOrganizationId",
        "issuedAt",
        "expiresAt",
        "state",
        "latestEventNumber",
        "consumedReleaseId"
      })
  public record ConsentView(
      UUID id,
      UUID recipientOrganizationId,
      UUID sourceOrganizationId,
      Instant issuedAt,
      Instant expiresAt,
      ConsentState state,
      @Schema(minimum = "1", maximum = "9007199254740991") long latestEventNumber,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          UUID consumedReleaseId) {}

  @Schema(
      name = "ReleaseConsentPage",
      requiredProperties = {"items", "limit", "nextCursor"})
  public record ConsentPage(
      List<ConsentView> items, int limit, @Schema(types = {"string", "null"}) String nextCursor) {}

  @Schema(
      name = "PatternReleaseEventSummary",
      requiredProperties = {"id", "releaseId", "eventNumber", "kind", "occurredAt"})
  public record EventSummary(
      UUID id,
      UUID releaseId,
      @Schema(minimum = "1", maximum = "9007199254740991") long eventNumber,
      EventKind kind,
      Instant occurredAt) {}

  @Schema(
      name = "PatternReleaseEventPage",
      requiredProperties = {"items", "limit", "nextMaxEventNumber"})
  public record EventPage(
      List<EventSummary> items,
      int limit,
      @Schema(
              types = {"integer", "null"},
              minimum = "1",
              maximum = "9007199254740991")
          Long nextMaxEventNumber) {}

  @Schema(
      name = "PatternReleaseSourceSummary",
      requiredProperties = {
        "id",
        "consentId",
        "sourceOrganizationId",
        "recipientOrganizationId",
        "projectId",
        "styleId",
        "patternId",
        "patternRevisionId",
        "patternRevisionNumber",
        "artifactId",
        "declaredFormat",
        "displayName",
        "sizeBytes",
        "purpose",
        "releasedAt",
        "expiresAt"
      })
  public record SourceSummary(
      UUID id,
      UUID consentId,
      UUID sourceOrganizationId,
      UUID recipientOrganizationId,
      UUID projectId,
      UUID styleId,
      UUID patternId,
      UUID patternRevisionId,
      @Schema(minimum = "1", maximum = "9007199254740991") long patternRevisionNumber,
      UUID artifactId,
      String declaredFormat,
      String displayName,
      @Schema(minimum = "1", maximum = "10485760") long sizeBytes,
      String purpose,
      Instant releasedAt,
      Instant expiresAt) {}

  @Schema(
      name = "PatternReleaseSourceView",
      requiredProperties = {"release", "latestEventNumber", "lifecycle", "effectiveState"})
  public record SourceView(
      SourceSummary release,
      @Schema(minimum = "1", maximum = "9007199254740991") long latestEventNumber,
      EventKind lifecycle,
      EffectiveState effectiveState) {
    public SourceView(SourceSummary release, long head, EventKind lifecycle) {
      this(release, head, lifecycle, EffectiveState.UNAVAILABLE);
    }
  }

  @Schema(
      name = "PatternReleaseSourcePage",
      requiredProperties = {"items", "limit", "nextCursor"})
  public record SourcePage(
      List<SourceSummary> items,
      int limit,
      @Schema(types = {"string", "null"}) String nextCursor) {}

  @Schema(
      name = "ReceivedPatternRelease",
      oneOf = {ActiveReceived.class, InactiveReceived.class})
  public sealed interface Received permits ActiveReceived, InactiveReceived {
    UUID releaseId();

    UUID sourceOrganizationId();

    UUID recipientOrganizationId();

    Instant releasedAt();

    Instant expiresAt();

    String effectiveState();
  }

  @Schema(
      name = "ActiveReceivedPatternRelease",
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
      requiredProperties = {
        "releaseId",
        "sourceOrganizationId",
        "recipientOrganizationId",
        "patternRevisionId",
        "patternRevisionNumber",
        "artifactId",
        "declaredFormat",
        "displayName",
        "sizeBytes",
        "purpose",
        "releasedAt",
        "expiresAt",
        "effectiveState"
      })
  public record ActiveReceived(
      UUID releaseId,
      UUID sourceOrganizationId,
      UUID recipientOrganizationId,
      UUID patternRevisionId,
      @Schema(minimum = "1", maximum = "9007199254740991") long patternRevisionNumber,
      UUID artifactId,
      @Schema(allowableValues = {"DXF_AAMA", "DXF_ASTM", "PDF"}) String declaredFormat,
      String displayName,
      @Schema(minimum = "1", maximum = "10485760") long sizeBytes,
      String purpose,
      Instant releasedAt,
      Instant expiresAt,
      @Schema(allowableValues = {"ACTIVE"}) String effectiveState)
      implements Received {}

  @Schema(
      name = "InactiveReceivedPatternRelease",
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
      requiredProperties = {
        "releaseId",
        "sourceOrganizationId",
        "recipientOrganizationId",
        "releasedAt",
        "expiresAt",
        "effectiveState"
      })
  public record InactiveReceived(
      UUID releaseId,
      UUID sourceOrganizationId,
      UUID recipientOrganizationId,
      Instant releasedAt,
      Instant expiresAt,
      @Schema(allowableValues = {"EXPIRED", "REVOKED", "WITHDRAWN", "UNAVAILABLE"})
          String effectiveState)
      implements Received {}

  @Schema(
      name = "ReceivedPatternReleasePage",
      requiredProperties = {"items", "limit", "nextCursor"})
  public record ReceivedPage(
      List<Received> items, int limit, @Schema(types = {"string", "null"}) String nextCursor) {}
}
