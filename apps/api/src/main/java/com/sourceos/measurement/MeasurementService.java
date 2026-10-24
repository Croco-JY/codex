package com.sourceos.measurement;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.identity.IdentityService;
import com.sourceos.shared.ValidationRules;
import com.sourceos.shared.WritePreconditions;
import com.sourceos.style.StyleService;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.sql.Types;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.*;
import tools.jackson.databind.*;
import tools.jackson.databind.annotation.JsonDeserialize;

@Service
public class MeasurementService {
  public static final long MAX_REVISION = 9007199254740991L;

  public enum UnitSystem {
    MM,
    CM,
    IN
  }

  @Schema(
      name = "MeasurementPointInput",
      requiredProperties = {"code", "label", "value"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record PointInput(
      @Schema(pattern = "^[A-Z0-9][A-Z0-9._/-]{0,79}$", minLength = 1, maxLength = 80)
          @JsonDeserialize(using = TextInput.class)
          String code,
      @Schema(minLength = 1, maxLength = 160) @JsonDeserialize(using = TextInput.class)
          String label,
      @Schema(type = "string", format = "decimal", pattern = "^[0-9]{1,15}(\\.[0-9]{1,4})?$")
          @JsonDeserialize(using = DecimalInput.class)
          BigDecimal value,
      @Schema(
              types = {"string", "null"},
              format = "decimal",
              pattern = "^[0-9]{1,15}(\\.[0-9]{1,4})?$")
          @JsonDeserialize(using = DecimalInput.class)
          BigDecimal tolerancePlus,
      @Schema(
              types = {"string", "null"},
              format = "decimal",
              pattern = "^[0-9]{1,15}(\\.[0-9]{1,4})?$")
          @JsonDeserialize(using = DecimalInput.class)
          BigDecimal toleranceMinus,
      @Schema(
              types = {"string", "null"},
              maxLength = 1000)
          @JsonDeserialize(using = TextInput.class)
          String notes) {}

  @Schema(
      name = "MeasurementSpecCreateInput",
      requiredProperties = {"baseSize", "unitSystem", "points"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record CreateInput(
      @Schema(minLength = 1, maxLength = 40) @JsonDeserialize(using = TextInput.class)
          String baseSize,
      @JsonDeserialize(using = UnitInput.class) UnitSystem unitSystem,
      @io.swagger.v3.oas.annotations.media.ArraySchema(minItems = 1, maxItems = 500)
          List<PointInput> points) {}

  @Schema(
      name = "MeasurementRevisionCreateInput",
      requiredProperties = {"expectedLatestRevisionNumber", "baseSize", "unitSystem", "points"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record RevisionInput(
      @Schema(minimum = "1", maximum = "9007199254740991") @JsonDeserialize(using = HeadInput.class)
          Long expectedLatestRevisionNumber,
      @Schema(minLength = 1, maxLength = 40) @JsonDeserialize(using = TextInput.class)
          String baseSize,
      @JsonDeserialize(using = UnitInput.class) UnitSystem unitSystem,
      @io.swagger.v3.oas.annotations.media.ArraySchema(minItems = 1, maxItems = 500)
          List<PointInput> points) {}

  @Schema(
      name = "MeasurementPointView",
      requiredProperties = {
        "position",
        "code",
        "label",
        "value",
        "tolerancePlus",
        "toleranceMinus",
        "notes"
      })
  public record PointView(
      int position,
      String code,
      String label,
      @Schema(type = "string", format = "decimal") BigDecimal value,
      @Schema(
              types = {"string", "null"},
              format = "decimal")
          BigDecimal tolerancePlus,
      @Schema(
              types = {"string", "null"},
              format = "decimal")
          BigDecimal toleranceMinus,
      @Schema(types = {"string", "null"}) String notes) {}

  @Schema(
      name = "MeasurementRevisionView",
      requiredProperties = {
        "id",
        "measurementSpecId",
        "styleId",
        "revisionNumber",
        "baseSize",
        "unitSystem",
        "createdAt",
        "points"
      })
  public record RevisionView(
      UUID id,
      UUID measurementSpecId,
      UUID styleId,
      @Schema(minimum = "1", maximum = "9007199254740991") long revisionNumber,
      String baseSize,
      UnitSystem unitSystem,
      Instant createdAt,
      List<PointView> points) {}

  @Schema(
      name = "MeasurementRevisionSummary",
      requiredProperties = {
        "id",
        "measurementSpecId",
        "styleId",
        "revisionNumber",
        "baseSize",
        "unitSystem",
        "pointCount",
        "createdAt"
      })
  public record Summary(
      UUID id,
      UUID measurementSpecId,
      UUID styleId,
      @Schema(minimum = "1", maximum = "9007199254740991") long revisionNumber,
      String baseSize,
      UnitSystem unitSystem,
      @Schema(minimum = "1", maximum = "500") int pointCount,
      Instant createdAt) {}

  @Schema(
      name = "MeasurementRevisionPage",
      requiredProperties = {"items", "limit", "nextMaxRevisionNumber"})
  public record Page(
      List<Summary> items,
      int limit,
      @Schema(
              types = {"integer", "null"},
              format = "int64",
              minimum = "1",
              maximum = "9007199254740991")
          Long nextMaxRevisionNumber) {}

  @Schema(
      name = "MeasurementSpecView",
      requiredProperties = {"id", "styleId", "latestRevision", "createdAt"})
  public record SpecView(UUID id, UUID styleId, RevisionView latestRevision, Instant createdAt) {}

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

  static class UnitInput extends ValueDeserializer<UnitSystem> {
    @Override
    public UnitSystem deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("Unit system required");
      try {
        return UnitSystem.valueOf(p.getString());
      } catch (IllegalArgumentException e) {
        throw ValidationRules.bad("Invalid unit system");
      }
    }
  }

  static class HeadInput extends ValueDeserializer<Long> {
    @Override
    public Long deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_NUMBER_INT))
        throw ValidationRules.bad("Integer revision baseline required");
      long n = p.getLongValue();
      if (n < 1 || n > MAX_REVISION) throw ValidationRules.bad("Invalid revision baseline");
      return n;
    }
  }

  private record Spec(UUID id, UUID styleId, Instant createdAt) {}

  private record Revision(
      UUID id, UUID spec, UUID style, long number, String size, UnitSystem unit, Instant created) {}

  private static final String REV_COLUMNS =
      "id,measurement_spec_id,style_id,revision_number,base_size,unit_system,created_at";
  private static final RowMapper<Spec> SPEC =
      (r, n) ->
          new Spec(
              r.getObject("id", UUID.class),
              r.getObject("style_id", UUID.class),
              r.getTimestamp("created_at").toInstant());
  private static final RowMapper<Revision> REV =
      (r, n) ->
          new Revision(
              r.getObject("id", UUID.class),
              r.getObject("measurement_spec_id", UUID.class),
              r.getObject("style_id", UUID.class),
              r.getLong("revision_number"),
              r.getString("base_size"),
              UnitSystem.valueOf(r.getString("unit_system")),
              r.getTimestamp("created_at").toInstant());
  private final JdbcClient jdbc;
  private final StyleService styles;
  private final IdentityService identities;
  private final AuditRecorder audit;

  public MeasurementService(
      JdbcClient jdbc, StyleService styles, IdentityService identities, AuditRecorder audit) {
    this.jdbc = jdbc;
    this.styles = styles;
    this.identities = identities;
    this.audit = audit;
  }

  private Optional<Spec> find(UUID style, boolean lock) {
    return jdbc.sql(
            "SELECT id,style_id,created_at FROM measurement_spec WHERE style_id=:style"
                + (lock ? " FOR UPDATE" : ""))
        .param("style", style)
        .query(SPEC)
        .optional();
  }

  private Spec required(UUID style, boolean lock) {
    return find(style, lock).orElseThrow(ValidationRules::missing);
  }

  private Revision latest(Spec s) {
    return jdbc.sql(
            "SELECT "
                + REV_COLUMNS
                + " FROM measurement_revision WHERE measurement_spec_id=:spec ORDER BY"
                + " revision_number DESC LIMIT 1")
        .param("spec", s.id())
        .query(REV)
        .optional()
        .orElseThrow(() -> new IllegalStateException("Incomplete measurement aggregate"));
  }

  private RevisionView view(Revision r) {
    var points =
        jdbc.sql(
                "SELECT position,code,label,value,tolerance_plus,tolerance_minus,notes FROM"
                    + " measurement_point WHERE measurement_revision_id=:id ORDER BY position")
            .param("id", r.id())
            .query(
                (q, n) ->
                    new PointView(
                        q.getInt("position"),
                        q.getString("code"),
                        q.getString("label"),
                        q.getBigDecimal("value"),
                        q.getBigDecimal("tolerance_plus"),
                        q.getBigDecimal("tolerance_minus"),
                        q.getString("notes")))
            .list();
    return new RevisionView(
        r.id(),
        r.spec(),
        r.style(),
        r.number(),
        r.size(),
        r.unit(),
        r.created(),
        List.copyOf(points));
  }

  private SpecView view(Spec s, RevisionView r) {
    return new SpecView(s.id(), s.styleId(), r, s.createdAt());
  }

  @Transactional(readOnly = true)
  public SpecView read(UUID org, UUID project, UUID style) {
    styles.readContext(org, project, style);
    var s = required(style, false);
    return view(s, view(latest(s)));
  }

  @Transactional(readOnly = true)
  public RevisionView readRevision(UUID org, UUID project, UUID style, UUID revision) {
    styles.readContext(org, project, style);
    var s = required(style, false);
    return view(
        jdbc.sql(
                "SELECT "
                    + REV_COLUMNS
                    + " FROM measurement_revision WHERE id=:id AND measurement_spec_id=:spec AND"
                    + " style_id=:style")
            .param("id", revision)
            .param("spec", s.id())
            .param("style", style)
            .query(REV)
            .optional()
            .orElseThrow(ValidationRules::missing));
  }

  @Transactional(readOnly = true)
  public Page history(UUID org, UUID project, UUID style, int limit, Long max) {
    styles.readContext(org, project, style);
    var s = required(style, false);
    if (limit < 1 || limit > 100 || (max != null && (max < 1 || max > MAX_REVISION)))
      throw ValidationRules.bad("Invalid bounded revision page");
    var rows =
        jdbc.sql(
                "SELECT r.*, (SELECT count(*) FROM measurement_point p WHERE"
                    + " p.measurement_revision_id=r.id) AS point_count FROM measurement_revision r"
                    + " WHERE measurement_spec_id=:spec AND revision_number<=:max ORDER BY"
                    + " revision_number DESC LIMIT :limit")
            .param("spec", s.id())
            .param("max", max == null ? MAX_REVISION : max)
            .param("limit", limit + 1)
            .query(
                (r, n) ->
                    new Summary(
                        r.getObject("id", UUID.class),
                        r.getObject("measurement_spec_id", UUID.class),
                        r.getObject("style_id", UUID.class),
                        r.getLong("revision_number"),
                        r.getString("base_size"),
                        UnitSystem.valueOf(r.getString("unit_system")),
                        r.getInt("point_count"),
                        r.getTimestamp("created_at").toInstant()))
            .list();
    return new Page(
        List.copyOf(rows.subList(0, Math.min(limit, rows.size()))),
        limit,
        rows.size() > limit ? rows.get(limit).revisionNumber() : null);
  }

  private void active(UUID org, UUID project, UUID style) {
    var c = styles.lockContextForWrite(org, project, style);
    if (c.projectStatus() != StyleService.ParentStatus.ACTIVE
        || c.styleStatus() != StyleService.Status.ACTIVE) throw ValidationRules.conflict();
  }

  private static String text(String v, int max, boolean optional) {
    if (v == null) {
      if (optional) return null;
      throw ValidationRules.bad("Required measurement text");
    }
    // Same outer whitespace canonicalization as browser String.trim, including Unicode separators.
    String s = v.replaceAll("^[\\s\\p{Z}\\uFEFF]+|[\\s\\p{Z}\\uFEFF]+$", "");
    if (optional && s.isEmpty()) return null;
    if (s.isEmpty() || s.length() > max) throw ValidationRules.bad("Invalid measurement text");
    return s;
  }

  private static void decimal(BigDecimal v, boolean required) {
    if (v == null) {
      if (required) throw ValidationRules.bad("Measurement value required");
      return;
    }
    if (v.signum() < 0 || v.scale() < 0 || v.scale() > 4 || v.precision() - v.scale() > 15)
      throw ValidationRules.bad("Invalid exact decimal");
  }

  private static CreateInput validated(String size, UnitSystem unit, List<PointInput> points) {
    String base = text(size, 40, false);
    if (unit == null || points == null || points.isEmpty() || points.size() > 500)
      throw ValidationRules.bad("Unit and 1..500 points required");
    var seen = new HashSet<String>();
    var clean = new ArrayList<PointInput>();
    for (var p : points) {
      if (p == null
          || p.code() == null
          || !p.code().matches("[A-Z0-9][A-Z0-9._/-]{0,79}")
          || !seen.add(p.code())) throw ValidationRules.bad("Invalid or duplicate POM code");
      decimal(p.value(), true);
      decimal(p.tolerancePlus(), false);
      decimal(p.toleranceMinus(), false);
      clean.add(
          new PointInput(
              p.code(),
              text(p.label(), 160, false),
              p.value(),
              p.tolerancePlus(),
              p.toleranceMinus(),
              text(p.notes(), 1000, true)));
    }
    return new CreateInput(base, unit, List.copyOf(clean));
  }

  @Transactional
  public SpecView create(
      UUID org,
      UUID project,
      UUID style,
      CreateInput input,
      List<String> precondition,
      String requestId) {
    active(org, project, style);
    if (precondition == null
        || precondition.size() != 1
        || !"*".equals(precondition.getFirst().replaceAll("^[ \\t]+|[ \\t]+$", "")))
      throw ValidationRules.bad("Exactly one If-None-Match: * required");
    var clean = validated(input.baseSize(), input.unitSystem(), input.points());
    var s =
        jdbc.sql(
                "INSERT INTO measurement_spec(id,style_id) VALUES(:id,:style) ON CONFLICT(style_id)"
                    + " DO NOTHING RETURNING id,style_id,created_at")
            .param("id", UUID.randomUUID())
            .param("style", style)
            .query(SPEC)
            .optional()
            .orElseThrow(WritePreconditions::failed);
    var revision = construct(s, 1, clean, requestId);
    audit.organizationChanged(
        org,
        "measurement_spec.created",
        "MeasurementSpec",
        s.id(),
        requestId,
        null,
        Map.of("styleId", style));
    record(org, revision, requestId);
    return view(s, revision);
  }

  @Transactional
  public RevisionView createRevision(
      UUID org, UUID project, UUID style, RevisionInput input, String requestId) {
    active(org, project, style);
    var s = required(style, true);
    if (input.expectedLatestRevisionNumber() == null
        || input.expectedLatestRevisionNumber() < 1
        || input.expectedLatestRevisionNumber() > MAX_REVISION)
      throw ValidationRules.bad("Revision baseline required");
    var clean = validated(input.baseSize(), input.unitSystem(), input.points());
    long current = latest(s).number();
    if (input.expectedLatestRevisionNumber() != current || current == MAX_REVISION)
      throw ValidationRules.conflict();
    var r = construct(s, current + 1, clean, requestId);
    record(org, r, requestId);
    return r;
  }

  private RevisionView construct(Spec s, long number, CreateInput input, String requestId) {
    var actor = identities.current();
    var r =
        jdbc.sql(
                "INSERT INTO"
                    + " measurement_revision(id,measurement_spec_id,style_id,revision_number,base_size,unit_system,created_by_issuer,created_by_subject)"
                    + " VALUES(:id,:spec,:style,:number,:size,:unit,:issuer,:subject) RETURNING "
                    + REV_COLUMNS)
            .param("id", UUID.randomUUID())
            .param("spec", s.id())
            .param("style", s.styleId())
            .param("number", number)
            .param("size", input.baseSize())
            .param("unit", input.unitSystem().name())
            .param("issuer", actor.issuer())
            .param("subject", actor.subject())
            .query(REV)
            .single();
    for (int i = 0; i < input.points().size(); i++) {
      var p = input.points().get(i);
      jdbc.sql(
              "INSERT INTO"
                  + " measurement_point(measurement_revision_id,position,code,label,value,tolerance_plus,tolerance_minus,notes)"
                  + " VALUES(:id,:position,:code,:label,:value,:plus,:minus,:notes)")
          .param("id", r.id())
          .param("position", i)
          .param("code", p.code())
          .param("label", p.label())
          .param("value", p.value(), Types.NUMERIC)
          .param("plus", p.tolerancePlus(), Types.NUMERIC)
          .param("minus", p.toleranceMinus(), Types.NUMERIC)
          .param("notes", p.notes(), Types.VARCHAR)
          .update();
    }
    jdbc.sql("UPDATE measurement_revision SET sealed=true WHERE id=:id")
        .param("id", r.id())
        .update();
    return view(r);
  }

  private void record(UUID org, RevisionView r, String requestId) {
    audit.organizationChanged(
        org,
        "measurement_revision.created",
        "MeasurementRevision",
        r.id(),
        requestId,
        null,
        Map.of(
            "styleId",
            r.styleId(),
            "measurementSpecId",
            r.measurementSpecId(),
            "measurementRevisionNumber",
            r.revisionNumber()));
  }
}
