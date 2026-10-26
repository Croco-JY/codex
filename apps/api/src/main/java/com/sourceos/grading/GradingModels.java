package com.sourceos.grading;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import tools.jackson.databind.annotation.JsonDeserialize;

public final class GradingModels {
  private GradingModels() {}

  public enum Status {
    ACTIVE,
    ARCHIVED
  }

  public enum Filter {
    ACTIVE,
    ARCHIVED,
    ALL
  }

  public enum Unit {
    MM,
    CM,
    IN
  }

  @Schema(
      name = "GradeSizeInput",
      requiredProperties = {"code", "label"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record SizeInput(
      @Schema(pattern = "^[A-Z0-9][A-Z0-9._/-]{0,39}$", maxLength = 40)
          @JsonDeserialize(using = GradingJson.Text.class)
          String code,
      @Schema(minLength = 1, maxLength = 80) @JsonDeserialize(using = GradingJson.Text.class)
          String label) {}

  @Schema(
      name = "GradeRuleValueInput",
      requiredProperties = {"sizeCode", "delta"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record ValueInput(
      @JsonDeserialize(using = GradingJson.Text.class) String sizeCode,
      @Schema(type = "string", pattern = "^-?[0-9]{1,15}(\\.[0-9]{1,4})?$")
          @JsonDeserialize(using = GradingJson.Decimal.class)
          BigDecimal delta) {}

  @Schema(
      name = "GradeRuleInput",
      requiredProperties = {"code", "label", "values"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record RuleInput(
      @Schema(pattern = "^[A-Z0-9][A-Z0-9._/-]{0,79}$", maxLength = 80)
          @JsonDeserialize(using = GradingJson.Text.class)
          String code,
      @Schema(minLength = 1, maxLength = 160) @JsonDeserialize(using = GradingJson.Text.class)
          String label,
      @Schema(
              types = {"string", "null"},
              maxLength = 1000)
          @JsonDeserialize(using = GradingJson.Text.class)
          String notes,
      List<ValueInput> values) {}

  @Schema(
      name = "GradeRuleSetCreateInput",
      requiredProperties = {"name", "baseSizeCode", "unitSystem", "sizes", "rules"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record CreateInput(
      @Schema(minLength = 1, maxLength = 160) @JsonDeserialize(using = GradingJson.Text.class)
          String name,
      @JsonDeserialize(using = GradingJson.Text.class) String baseSizeCode,
      @JsonDeserialize(using = GradingJson.Unit.class) Unit unitSystem,
      @Schema(
              types = {"string", "null"},
              maxLength = 1000)
          @JsonDeserialize(using = GradingJson.Text.class)
          String notes,
      List<SizeInput> sizes,
      List<RuleInput> rules) {}

  @Schema(
      name = "GradeRuleSetRevisionCreateInput",
      requiredProperties = {
        "expectedLatestRevisionNumber",
        "name",
        "baseSizeCode",
        "unitSystem",
        "sizes",
        "rules"
      },
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record RevisionInput(
      @Schema(minimum = "1", maximum = "9007199254740991")
          @JsonDeserialize(using = GradingJson.Integer.class)
          Long expectedLatestRevisionNumber,
      @Schema(minLength = 1, maxLength = 160) @JsonDeserialize(using = GradingJson.Text.class)
          String name,
      @JsonDeserialize(using = GradingJson.Text.class) String baseSizeCode,
      @JsonDeserialize(using = GradingJson.Unit.class) Unit unitSystem,
      @Schema(
              types = {"string", "null"},
              maxLength = 1000)
          @JsonDeserialize(using = GradingJson.Text.class)
          String notes,
      List<SizeInput> sizes,
      List<RuleInput> rules) {
    public CreateInput snapshot() {
      return new CreateInput(name, baseSizeCode, unitSystem, notes, sizes, rules);
    }
  }

  @Schema(
      name = "GradeRuleSetLifecycleInput",
      requiredProperties = {"status", "version"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record LifecycleInput(
      @JsonDeserialize(using = GradingJson.Status.class) Status status,
      @Schema(minimum = "0", maximum = "9007199254740991")
          @JsonDeserialize(using = GradingJson.Integer.class)
          Long version) {}

  @Schema(
      name = "GradeSizeView",
      requiredProperties = {"position", "code", "label"})
  public record SizeView(int position, String code, String label) {}

  @Schema(
      name = "GradeRuleValueView",
      requiredProperties = {"sizeCode", "delta"})
  public record ValueView(String sizeCode, BigDecimal delta) {}

  @Schema(
      name = "GradeRuleView",
      requiredProperties = {"position", "code", "label", "notes", "values"})
  public record RuleView(
      int position,
      String code,
      String label,
      @Schema(types = {"string", "null"}) String notes,
      List<ValueView> values) {}

  @Schema(
      name = "GradeRuleSetRevisionView",
      requiredProperties = {
        "id",
        "gradeRuleSetId",
        "styleId",
        "revisionNumber",
        "name",
        "baseSizeCode",
        "unitSystem",
        "notes",
        "createdAt",
        "sizes",
        "rules"
      })
  public record RevisionView(
      UUID id,
      UUID gradeRuleSetId,
      UUID styleId,
      @Schema(minimum = "1", maximum = "9007199254740991") long revisionNumber,
      String name,
      String baseSizeCode,
      Unit unitSystem,
      @Schema(types = {"string", "null"}) String notes,
      Instant createdAt,
      List<SizeView> sizes,
      List<RuleView> rules) {}

  @Schema(
      name = "GradeRuleSetRevisionSummary",
      requiredProperties = {
        "id",
        "gradeRuleSetId",
        "styleId",
        "revisionNumber",
        "name",
        "baseSizeCode",
        "unitSystem",
        "sizeCount",
        "ruleCount",
        "createdAt"
      })
  public record RevisionSummary(
      UUID id,
      UUID gradeRuleSetId,
      UUID styleId,
      long revisionNumber,
      String name,
      String baseSizeCode,
      Unit unitSystem,
      int sizeCount,
      int ruleCount,
      Instant createdAt) {}

  @Schema(
      name = "GradeRuleSetView",
      requiredProperties = {
        "id",
        "styleId",
        "status",
        "version",
        "createdAt",
        "updatedAt",
        "latestRevision"
      })
  public record View(
      UUID id,
      UUID styleId,
      Status status,
      long version,
      Instant createdAt,
      Instant updatedAt,
      RevisionView latestRevision) {}

  @Schema(
      name = "GradeRuleSetListItem",
      requiredProperties = {
        "id",
        "styleId",
        "status",
        "version",
        "createdAt",
        "updatedAt",
        "latestRevision"
      })
  public record ListItem(
      UUID id,
      UUID styleId,
      Status status,
      long version,
      Instant createdAt,
      Instant updatedAt,
      RevisionSummary latestRevision) {}

  @Schema(
      name = "GradeRuleSetLifecycleView",
      requiredProperties = {
        "id",
        "styleId",
        "status",
        "version",
        "createdAt",
        "updatedAt",
        "latestRevision"
      })
  public record LifecycleView(
      UUID id,
      UUID styleId,
      Status status,
      long version,
      Instant createdAt,
      Instant updatedAt,
      RevisionSummary latestRevision) {}

  @Schema(
      name = "GradeRuleSetPage",
      requiredProperties = {"items", "limit", "nextCursor"})
  public record Page(
      List<ListItem> items, int limit, @Schema(types = {"string", "null"}) String nextCursor) {}

  @Schema(
      name = "GradeRuleSetRevisionPage",
      requiredProperties = {"items", "limit", "nextMaxRevisionNumber"})
  public record RevisionPage(
      List<RevisionSummary> items,
      int limit,
      @Schema(
              types = {"integer", "null"},
              format = "int64",
              minimum = "1",
              maximum = "9007199254740991")
          Long nextMaxRevisionNumber) {}
}
