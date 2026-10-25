package com.sourceos.pattern;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.identity.IdentityService;
import com.sourceos.measurement.MeasurementService;
import com.sourceos.shared.Keysets;
import com.sourceos.shared.ValidationRules;
import com.sourceos.style.StyleService;
import io.swagger.v3.oas.annotations.media.Schema;
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
public class PatternService {
  public static final long MAX = 9007199254740991L;

  public enum Status {
    ACTIVE,
    ARCHIVED
  }

  public enum Filter {
    ACTIVE,
    ARCHIVED,
    ALL
  }

  @Schema(
      name = "PatternCreateInput",
      requiredProperties = {"name"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record CreateInput(
      @Schema(minLength = 1, maxLength = 160) @JsonDeserialize(using = TextInput.class) String name,
      @Schema(
              types = {"string", "null"},
              maxLength = 160)
          @JsonDeserialize(using = TextInput.class)
          String purpose,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          @JsonDeserialize(using = UuidInput.class)
          UUID measurementRevisionId) {}

  @Schema(
      name = "PatternRevisionCreateInput",
      requiredProperties = {"expectedLatestRevisionNumber", "name"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record RevisionInput(
      @Schema(minimum = "1", maximum = "9007199254740991")
          @JsonDeserialize(using = IntegerInput.class)
          Long expectedLatestRevisionNumber,
      @Schema(minLength = 1, maxLength = 160) @JsonDeserialize(using = TextInput.class) String name,
      @Schema(
              types = {"string", "null"},
              maxLength = 160)
          @JsonDeserialize(using = TextInput.class)
          String purpose,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          @JsonDeserialize(using = UuidInput.class)
          UUID measurementRevisionId) {}

  @Schema(
      name = "PatternLifecycleInput",
      requiredProperties = {"status", "version"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record LifecycleInput(
      @JsonDeserialize(using = StatusInput.class) Status status,
      @Schema(minimum = "0", maximum = "9007199254740991")
          @JsonDeserialize(using = IntegerInput.class)
          Long version) {}

  @Schema(
      name = "PatternRevisionView",
      requiredProperties = {
        "id",
        "patternId",
        "styleId",
        "revisionNumber",
        "name",
        "purpose",
        "measurementRevisionId",
        "createdAt"
      })
  public record RevisionView(
      UUID id,
      UUID patternId,
      UUID styleId,
      @Schema(minimum = "1", maximum = "9007199254740991") long revisionNumber,
      String name,
      @Schema(types = {"string", "null"}) String purpose,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          UUID measurementRevisionId,
      Instant createdAt) {}

  @Schema(
      name = "PatternRevisionSummary",
      requiredProperties = {
        "id",
        "patternId",
        "styleId",
        "revisionNumber",
        "name",
        "purpose",
        "measurementRevisionId",
        "createdAt"
      })
  public record RevisionSummary(
      UUID id,
      UUID patternId,
      UUID styleId,
      long revisionNumber,
      String name,
      @Schema(types = {"string", "null"}) String purpose,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          UUID measurementRevisionId,
      Instant createdAt) {}

  @Schema(
      name = "PatternView",
      requiredProperties = {
        "id",
        "styleId",
        "status",
        "version",
        "latestRevision",
        "createdAt",
        "updatedAt"
      })
  public record View(
      UUID id,
      UUID styleId,
      Status status,
      @Schema(minimum = "0", maximum = "9007199254740991") long version,
      RevisionView latestRevision,
      Instant createdAt,
      Instant updatedAt) {}

  @Schema(
      name = "PatternSummary",
      requiredProperties = {
        "id",
        "styleId",
        "status",
        "version",
        "latestRevision",
        "createdAt",
        "updatedAt"
      })
  public record Summary(
      UUID id,
      UUID styleId,
      Status status,
      long version,
      RevisionSummary latestRevision,
      Instant createdAt,
      Instant updatedAt) {}

  @Schema(
      name = "PatternPage",
      requiredProperties = {"items", "limit", "nextCursor"})
  public record Page(
      List<Summary> items, int limit, @Schema(types = {"string", "null"}) String nextCursor) {}

  @Schema(
      name = "PatternRevisionPage",
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

  static class TextInput extends ValueDeserializer<String> {
    public String deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("Text required");
      return p.getString();
    }
  }

  static class UuidInput extends ValueDeserializer<UUID> {
    public UUID deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("UUID required");
      return Keysets.uuid(p.getString());
    }
  }

  static class IntegerInput extends ValueDeserializer<Long> {
    public Long deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_NUMBER_INT)) throw ValidationRules.bad("Integer required");
      long v = p.getLongValue();
      if (v < 0 || v > MAX) throw ValidationRules.bad("Invalid integer");
      return v;
    }
  }

  static class StatusInput extends ValueDeserializer<Status> {
    public Status deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("Status required");
      try {
        return Status.valueOf(p.getString());
      } catch (IllegalArgumentException e) {
        throw ValidationRules.bad("Invalid status");
      }
    }
  }

  private record Aggregate(
      UUID id, UUID styleId, Status status, long version, Instant createdAt, Instant updatedAt) {}

  private static final String COL = "id,style_id,status,version,created_at,updated_at";
  private static final String REV =
      "id,pattern_id,style_id,revision_number,name,purpose,measurement_revision_id,created_at";
  private static final RowMapper<Aggregate> ROW =
      (r, n) ->
          new Aggregate(
              r.getObject("id", UUID.class),
              r.getObject("style_id", UUID.class),
              Status.valueOf(r.getString("status")),
              r.getLong("version"),
              r.getTimestamp("created_at").toInstant(),
              r.getTimestamp("updated_at").toInstant());
  private static final RowMapper<RevisionView> REVROW =
      (r, n) ->
          new RevisionView(
              r.getObject("id", UUID.class),
              r.getObject("pattern_id", UUID.class),
              r.getObject("style_id", UUID.class),
              r.getLong("revision_number"),
              r.getString("name"),
              r.getString("purpose"),
              r.getObject("measurement_revision_id", UUID.class),
              r.getTimestamp("created_at").toInstant());
  private final JdbcClient jdbc;
  private final StyleService styles;
  private final MeasurementService measurements;
  private final IdentityService identities;
  private final AuditRecorder audit;

  public PatternService(
      JdbcClient jdbc,
      StyleService styles,
      MeasurementService measurements,
      IdentityService identities,
      AuditRecorder audit) {
    this.jdbc = jdbc;
    this.styles = styles;
    this.measurements = measurements;
    this.identities = identities;
    this.audit = audit;
  }

  private Aggregate find(UUID style, UUID id, boolean lock) {
    return jdbc.sql(
            "SELECT "
                + COL
                + " FROM pattern WHERE style_id=:style AND id=:id"
                + (lock ? " FOR UPDATE" : ""))
        .param("style", style)
        .param("id", id)
        .query(ROW)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  private RevisionView latest(UUID id) {
    return jdbc.sql(
            "SELECT "
                + REV
                + " FROM pattern_revision WHERE pattern_id=:id ORDER BY revision_number DESC LIMIT"
                + " 1")
        .param("id", id)
        .query(REVROW)
        .optional()
        .orElseThrow(() -> new IllegalStateException("Incomplete pattern"));
  }

  private View view(Aggregate p) {
    return new View(
        p.id(), p.styleId(), p.status(), p.version(), latest(p.id()), p.createdAt(), p.updatedAt());
  }

  private static RevisionSummary summary(RevisionView r) {
    return new RevisionSummary(
        r.id(),
        r.patternId(),
        r.styleId(),
        r.revisionNumber(),
        r.name(),
        r.purpose(),
        r.measurementRevisionId(),
        r.createdAt());
  }

  private void active(UUID org, UUID project, UUID style) {
    var c = styles.lockContextForWrite(org, project, style);
    if (c.projectStatus() != StyleService.ParentStatus.ACTIVE
        || c.styleStatus() != StyleService.Status.ACTIVE) throw ValidationRules.conflict();
  }

  private static String text(String value, boolean required) {
    String s =
        value == null ? null : value.replaceAll("^[\\s\\p{Z}\\uFEFF]+|[\\s\\p{Z}\\uFEFF]+$", "");
    if (s != null && s.isEmpty()) s = null;
    if ((required && s == null) || (s != null && s.length() > 160))
      throw ValidationRules.bad("Invalid Pattern text");
    return s;
  }

  private CreateInput clean(
      UUID org, UUID project, UUID style, String name, String purpose, UUID pin) {
    var input = new CreateInput(text(name, true), text(purpose, false), pin);
    if (pin != null) measurements.referenceContext(org, project, style, pin);
    return input;
  }

  @Transactional(readOnly = true)
  public View read(UUID org, UUID project, UUID style, UUID id) {
    styles.readContext(org, project, style);
    return view(find(style, id, false));
  }

  @Transactional(readOnly = true)
  public Page list(UUID org, UUID project, UUID style, Filter filter, int limit, String cursor) {
    styles.readContext(org, project, style);
    if (filter == null) throw ValidationRules.bad("Filter required");
    var identity = List.of("patterns", style, filter);
    var a = Keysets.anchor(cursor, identity, limit);
    var rows =
        jdbc.sql(
                "SELECT p.*,r.id AS"
                    + " revision_id,r.revision_number,r.name,r.purpose,r.measurement_revision_id,r.created_at"
                    + " AS revision_at FROM pattern p LEFT JOIN LATERAL (SELECT * FROM"
                    + " pattern_revision WHERE pattern_id=p.id ORDER BY revision_number DESC LIMIT"
                    + " 1) r ON true WHERE p.style_id=:style AND (:filter='ALL' OR"
                    + " p.status=:filter) AND (CAST(:at AS timestamptz) IS NULL OR"
                    + " (p.created_at,p.id)<(:at,:anchor)) ORDER BY p.created_at DESC,p.id DESC"
                    + " LIMIT :limit")
            .param("style", style)
            .param("filter", filter.name())
            .param("at", Keysets.time(a.at()), Types.TIMESTAMP_WITH_TIMEZONE)
            .param("anchor", a.id(), Types.OTHER)
            .param("limit", limit + 1)
            .query(
                (r, n) -> {
                  if (r.getObject("revision_id", UUID.class) == null)
                    throw new IllegalStateException("Incomplete pattern");
                  return new Summary(
                      r.getObject("id", UUID.class),
                      r.getObject("style_id", UUID.class),
                      Status.valueOf(r.getString("status")),
                      r.getLong("version"),
                      new RevisionSummary(
                          r.getObject("revision_id", UUID.class),
                          r.getObject("id", UUID.class),
                          r.getObject("style_id", UUID.class),
                          r.getLong("revision_number"),
                          r.getString("name"),
                          r.getString("purpose"),
                          r.getObject("measurement_revision_id", UUID.class),
                          r.getTimestamp("revision_at").toInstant()),
                      r.getTimestamp("created_at").toInstant(),
                      r.getTimestamp("updated_at").toInstant());
                })
            .list();
    var p = Keysets.page(rows, limit, identity, Summary::createdAt, Summary::id);
    return new Page(p.items(), limit, p.nextCursor());
  }

  @Transactional(readOnly = true)
  public RevisionView readRevision(UUID org, UUID project, UUID style, UUID id, UUID revision) {
    styles.readContext(org, project, style);
    find(style, id, false);
    return jdbc.sql(
            "SELECT "
                + REV
                + " FROM pattern_revision WHERE id=:revision AND pattern_id=:id AND"
                + " style_id=:style")
        .param("revision", revision)
        .param("id", id)
        .param("style", style)
        .query(REVROW)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  @Transactional(readOnly = true)
  public RevisionPage history(UUID org, UUID project, UUID style, UUID id, int limit, Long max) {
    styles.readContext(org, project, style);
    find(style, id, false);
    Keysets.limit(limit);
    if (max != null && (max < 1 || max > MAX)) throw ValidationRules.bad("Invalid revision bound");
    var rows =
        jdbc.sql(
                "SELECT "
                    + REV
                    + " FROM pattern_revision WHERE pattern_id=:id AND revision_number<=:max ORDER"
                    + " BY revision_number DESC LIMIT :limit")
            .param("id", id)
            .param("max", max == null ? MAX : max)
            .param("limit", limit + 1)
            .query(REVROW)
            .list();
    return new RevisionPage(
        rows.subList(0, Math.min(limit, rows.size())).stream()
            .map(PatternService::summary)
            .toList(),
        limit,
        rows.size() > limit ? rows.get(limit).revisionNumber() : null);
  }

  @Transactional
  public View create(UUID org, UUID project, UUID style, CreateInput input, String requestId) {
    active(org, project, style);
    var c =
        clean(org, project, style, input.name(), input.purpose(), input.measurementRevisionId());
    var p =
        jdbc.sql("INSERT INTO pattern(id,style_id) VALUES(:id,:style) RETURNING " + COL)
            .param("id", UUID.randomUUID())
            .param("style", style)
            .query(ROW)
            .single();
    var r = insert(p, 1, c);
    audit.organizationChanged(org, "pattern.created", "Pattern", p.id(), requestId, null, state(p));
    record(org, r, requestId);
    return new View(p.id(), p.styleId(), p.status(), p.version(), r, p.createdAt(), p.updatedAt());
  }

  @Transactional
  public RevisionView createRevision(
      UUID org, UUID project, UUID style, UUID id, RevisionInput input, String requestId) {
    active(org, project, style);
    var c =
        clean(org, project, style, input.name(), input.purpose(), input.measurementRevisionId());
    if (input.expectedLatestRevisionNumber() == null
        || input.expectedLatestRevisionNumber() < 1
        || input.expectedLatestRevisionNumber() > MAX)
      throw ValidationRules.bad("Revision baseline required");
    var p = find(style, id, true);
    if (p.status() != Status.ACTIVE) throw ValidationRules.conflict();
    long current = latest(id).revisionNumber();
    if (current != input.expectedLatestRevisionNumber() || current == MAX)
      throw ValidationRules.conflict();
    var r = insert(p, current + 1, c);
    record(org, r, requestId);
    return r;
  }

  @Transactional
  public View lifecycle(
      UUID org, UUID project, UUID style, UUID id, LifecycleInput input, String requestId) {
    active(org, project, style);
    var p = find(style, id, true);
    if (input.status() == null
        || input.version() == null
        || input.version() < 0
        || input.version() > MAX) throw ValidationRules.bad("Status/version required");
    if (p.version() != input.version()) throw ValidationRules.conflict();
    if (p.status() == input.status()) return view(p);
    if (p.version() == MAX) throw ValidationRules.conflict();
    var next =
        jdbc.sql(
                "UPDATE pattern SET"
                    + " status=:status,version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at+interval"
                    + " '1 microsecond') WHERE id=:id RETURNING "
                    + COL)
            .param("status", input.status().name())
            .param("id", id)
            .query(ROW)
            .single();
    audit.organizationChanged(
        org,
        input.status() == Status.ARCHIVED ? "pattern.archived" : "pattern.reactivated",
        "Pattern",
        id,
        requestId,
        state(p),
        state(next));
    return view(next);
  }

  private RevisionView insert(Aggregate p, long number, CreateInput c) {
    var a = identities.current();
    return jdbc.sql(
            "INSERT INTO"
                + " pattern_revision(id,pattern_id,style_id,revision_number,name,purpose,measurement_revision_id,created_by_issuer,created_by_subject)"
                + " VALUES(:id,:pattern,:style,:number,:name,:purpose,:pin,:issuer,:subject)"
                + " RETURNING "
                + REV)
        .param("id", UUID.randomUUID())
        .param("pattern", p.id())
        .param("style", p.styleId())
        .param("number", number)
        .param("name", c.name())
        .param("purpose", c.purpose(), Types.VARCHAR)
        .param("pin", c.measurementRevisionId(), Types.OTHER)
        .param("issuer", a.issuer())
        .param("subject", a.subject())
        .query(REVROW)
        .single();
  }

  private Map<String, Object> state(Aggregate p) {
    return Map.of("styleId", p.styleId(), "status", p.status().name(), "version", p.version());
  }

  private void record(UUID org, RevisionView r, String requestId) {
    var s = new LinkedHashMap<String, Object>();
    s.put("styleId", r.styleId());
    s.put("patternId", r.patternId());
    s.put("patternRevisionNumber", r.revisionNumber());
    if (r.measurementRevisionId() != null)
      s.put("measurementRevisionId", r.measurementRevisionId());
    audit.organizationChanged(
        org, "pattern_revision.created", "PatternRevision", r.id(), requestId, null, s);
  }
}
