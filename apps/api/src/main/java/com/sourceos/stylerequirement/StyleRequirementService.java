package com.sourceos.stylerequirement;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.shared.ValidationRules;
import com.sourceos.shared.WritePreconditions;
import com.sourceos.style.StyleService;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.sql.Types;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.*;
import tools.jackson.databind.*;
import tools.jackson.databind.annotation.JsonDeserialize;

@Service
public class StyleRequirementService {
  public enum QuantityUnit {
    PCS,
    SET
  }

  @Schema(
      name = "StyleRequirementInput",
      requiredProperties = {"version"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record Input(
      @Schema(
              types = {"string", "null"},
              maxLength = 160)
          @JsonDeserialize(using = TextInput.class)
          String productType,
      @Schema(
              types = {"string", "null"},
              format = "decimal",
              pattern = "^[0-9]{1,15}(\\.[0-9]{1,4})?$")
          @JsonDeserialize(using = DecimalInput.class)
          BigDecimal targetQuantity,
      @JsonDeserialize(using = UnitInput.class) @Schema(nullable = true) QuantityUnit quantityUnit,
      @Schema(
              types = {"string", "null"},
              format = "decimal",
              pattern = "^[0-9]{1,15}(\\.[0-9]{1,4})?$")
          @JsonDeserialize(using = DecimalInput.class)
          BigDecimal targetCost,
      @Schema(
              types = {"string", "null"},
              pattern = "^[A-Z]{3}$")
          @JsonDeserialize(using = TextInput.class)
          String currency,
      @Schema(
              types = {"string", "null"},
              format = "date")
          @JsonDeserialize(using = DateInput.class)
          LocalDate targetDeliveryDate,
      @Schema(
              types = {"string", "null"},
              maxLength = 4000)
          @JsonDeserialize(using = TextInput.class)
          String notes,
      @Schema(minimum = "0", maximum = "9007199254740991")
          @JsonDeserialize(using = VersionInput.class)
          Long version) {}

  @Schema(
      name = "StyleRequirementView",
      requiredProperties = {
        "styleId",
        "productType",
        "targetQuantity",
        "quantityUnit",
        "targetCost",
        "currency",
        "targetDeliveryDate",
        "notes",
        "version",
        "createdAt",
        "updatedAt"
      })
  public record View(
      UUID styleId,
      @Schema(
              types = {"string", "null"},
              maxLength = 160)
          String productType,
      @Schema(
              types = {"string", "null"},
              format = "decimal")
          BigDecimal targetQuantity,
      @Schema(nullable = true) QuantityUnit quantityUnit,
      @Schema(
              types = {"string", "null"},
              format = "decimal")
          BigDecimal targetCost,
      @Schema(types = {"string", "null"}) String currency,
      @Schema(
              types = {"string", "null"},
              format = "date")
          LocalDate targetDeliveryDate,
      @Schema(
              types = {"string", "null"},
              maxLength = 4000)
          String notes,
      @Schema(minimum = "0") long version,
      Instant createdAt,
      Instant updatedAt) {}

  public record Written(View view, boolean created) {}

  static class TextInput extends ValueDeserializer<String> {
    @Override
    public String deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("Text required");
      return p.getString();
    }
  }

  static class DecimalInput extends ValueDeserializer<BigDecimal> {
    @Override
    public BigDecimal deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)
          || !p.getString().matches("[0-9]{1,15}(\\.[0-9]{1,4})?"))
        throw ValidationRules.bad("Invalid exact decimal string");
      return new BigDecimal(p.getString());
    }
  }

  static class UnitInput extends ValueDeserializer<QuantityUnit> {
    @Override
    public QuantityUnit deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING))
        throw ValidationRules.bad("Invalid product quantity unit");
      try {
        return QuantityUnit.valueOf(p.getString());
      } catch (IllegalArgumentException e) {
        throw ValidationRules.bad("Invalid product quantity unit");
      }
    }
  }

  static class VersionInput extends ValueDeserializer<Long> {
    @Override
    public Long deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_NUMBER_INT))
        throw ValidationRules.bad("Integer version required");
      long v = p.getLongValue();
      if (v < 0 || v > 9007199254740991L) throw ValidationRules.bad("Invalid version");
      return v;
    }
  }

  static class DateInput extends ValueDeserializer<LocalDate> {
    @Override
    public LocalDate deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)
          || !p.getString().matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
        throw ValidationRules.bad("Invalid ISO date");
      try {
        var date = LocalDate.parse(p.getString());
        if (date.getYear() < 1) throw ValidationRules.bad("Invalid ISO date");
        return date;
      } catch (DateTimeException e) {
        throw ValidationRules.bad("Invalid ISO date");
      }
    }
  }

  private static final String COLUMNS =
      "style_id,product_type,target_quantity,quantity_unit,target_cost,currency,target_delivery_date,notes,version,created_at,updated_at";
  private static final RowMapper<View> ROW =
      (r, n) ->
          new View(
              r.getObject("style_id", UUID.class),
              r.getString("product_type"),
              r.getBigDecimal("target_quantity"),
              r.getString("quantity_unit") == null
                  ? null
                  : QuantityUnit.valueOf(r.getString("quantity_unit")),
              r.getBigDecimal("target_cost"),
              r.getString("currency"),
              r.getObject("target_delivery_date", LocalDate.class),
              r.getString("notes"),
              r.getLong("version"),
              r.getTimestamp("created_at").toInstant(),
              r.getTimestamp("updated_at").toInstant());
  private final JdbcClient jdbc;
  private final StyleService styles;
  private final AuditRecorder audit;

  public StyleRequirementService(JdbcClient jdbc, StyleService styles, AuditRecorder audit) {
    this.jdbc = jdbc;
    this.styles = styles;
    this.audit = audit;
  }

  private View find(UUID id, boolean lock) {
    return jdbc.sql(
            "SELECT "
                + COLUMNS
                + " FROM style_requirement WHERE style_id=:id"
                + (lock ? " FOR UPDATE" : ""))
        .param("id", id)
        .query(ROW)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  @Transactional(readOnly = true)
  public View read(UUID org, UUID project, UUID style) {
    styles.readContext(org, project, style);
    return find(style, false);
  }

  private static String text(String s, int max) {
    String value = s == null || s.isBlank() ? null : s.strip();
    if (value != null && value.length() > max)
      throw ValidationRules.bad("Invalid Requirement text");
    return value;
  }

  private static void decimal(BigDecimal v) {
    if (v != null
        && (v.signum() < 0 || v.scale() > 4 || v.precision() - v.scale() > 15 || v.scale() < 0))
      throw ValidationRules.bad("Invalid exact decimal");
  }

  private static void currency(String value) {
    if (value == null) return;
    try {
      if (!value.matches("[A-Z]{3}")) throw new IllegalArgumentException();
      var c = Currency.getInstance(value);
      if (Set.of("XXX", "XTS").contains(value) || c.getDefaultFractionDigits() < 0)
        throw new IllegalArgumentException();
    } catch (IllegalArgumentException e) {
      throw ValidationRules.bad("Unrecognized commercial currency");
    }
  }

  private Map<String, Object> state(View v) {
    return Map.of("styleId", v.styleId(), "version", v.version());
  }

  @Transactional
  public Written write(
      UUID org, UUID project, UUID style, Input body, String ifNoneMatch, String requestId) {
    var context = styles.lockContextForWrite(org, project, style);
    if (context.projectStatus() != StyleService.ParentStatus.ACTIVE
        || context.styleStatus() != StyleService.Status.ACTIVE) throw ValidationRules.conflict();
    if (body.version() == null || body.version() < 0 || body.version() > 9007199254740991L)
      throw ValidationRules.bad("Version required");
    boolean create = WritePreconditions.createOnly(ifNoneMatch, body.version());
    String product = text(body.productType(), 160), notes = text(body.notes(), 4000);
    ValidationRules.notes(notes);
    decimal(body.targetQuantity());
    decimal(body.targetCost());
    currency(body.currency());
    if ((body.targetCost() == null) != (body.currency() == null)
        || ((body.targetCost() != null || body.targetQuantity() != null)
            && body.quantityUnit() == null))
      throw ValidationRules.bad("Cost/currency pair and product quantity unit required");
    if (body.targetDeliveryDate() != null
        && (body.targetDeliveryDate().getYear() < 1 || body.targetDeliveryDate().getYear() > 9999))
      throw ValidationRules.bad("Invalid ISO date");
    View before = create ? null : find(style, true);
    if (!create && before.version() != body.version()) throw ValidationRules.conflict();
    String sql =
        create
            ? "INSERT INTO"
                  + " style_requirement(style_id,product_type,target_quantity,quantity_unit,target_cost,currency,target_delivery_date,notes)"
                  + " VALUES(:id,:product,:quantity,:unit,:cost,:currency,:date,:notes) ON"
                  + " CONFLICT(style_id) DO NOTHING RETURNING "
                + COLUMNS
            : "UPDATE style_requirement SET"
                  + " product_type=:product,target_quantity=:quantity,quantity_unit=:unit,target_cost=:cost,currency=:currency,target_delivery_date=:date,notes=:notes,version=version+1,updated_at=now()"
                  + " WHERE style_id=:id AND version=:version RETURNING "
                + COLUMNS;
    var command =
        jdbc.sql(sql)
            .param("id", style)
            .param("product", product, Types.VARCHAR)
            .param("quantity", body.targetQuantity(), Types.NUMERIC)
            .param(
                "unit",
                body.quantityUnit() == null ? null : body.quantityUnit().name(),
                Types.VARCHAR)
            .param("cost", body.targetCost(), Types.NUMERIC)
            .param("currency", body.currency(), Types.VARCHAR)
            .param("date", body.targetDeliveryDate(), Types.DATE)
            .param("notes", notes, Types.VARCHAR);
    if (!create) command = command.param("version", body.version());
    var after =
        command
            .query(ROW)
            .optional()
            .orElseThrow(() -> create ? WritePreconditions.failed() : ValidationRules.conflict());
    audit.organizationChanged(
        org,
        create ? "requirement.created" : "requirement.updated",
        "StyleRequirement",
        style,
        requestId,
        before == null ? null : state(before),
        state(after));
    return new Written(after, create);
  }
}
