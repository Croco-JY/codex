package com.sourceos.style;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.project.ProjectService;
import com.sourceos.shared.ValidationRules;
import io.swagger.v3.oas.annotations.media.Schema;
import java.sql.Types;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.*;
import tools.jackson.databind.annotation.JsonDeserialize;

@Service
public class StyleService {
  public enum Status {
    ACTIVE,
    ARCHIVED
  }

  public enum ParentStatus {
    ACTIVE,
    ARCHIVED
  }

  @Schema(
      name = "StyleCreateInput",
      requiredProperties = {"name"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record CreateInput(
      @Schema(
              types = {"string", "null"},
              maxLength = 100)
          @JsonDeserialize(using = TextInput.class)
          String styleCode,
      @Schema(maxLength = 160, minLength = 1) @JsonDeserialize(using = TextInput.class) String name,
      @Schema(
              types = {"string", "null"},
              maxLength = 4000)
          @JsonDeserialize(using = TextInput.class)
          String description) {}

  @Schema(
      name = "StyleUpdateInput",
      requiredProperties = {"name", "status", "version"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record UpdateInput(
      @Schema(
              types = {"string", "null"},
              maxLength = 100)
          @JsonDeserialize(using = TextInput.class)
          String styleCode,
      @Schema(maxLength = 160, minLength = 1) @JsonDeserialize(using = TextInput.class) String name,
      @Schema(
              types = {"string", "null"},
              maxLength = 4000)
          @JsonDeserialize(using = TextInput.class)
          String description,
      @JsonDeserialize(using = StatusInput.class) Status status,
      @Schema(minimum = "0") @JsonDeserialize(using = VersionInput.class) Long version) {}

  @Schema(
      name = "StyleView",
      requiredProperties = {
        "id",
        "projectId",
        "styleCode",
        "name",
        "description",
        "status",
        "version",
        "createdAt",
        "updatedAt"
      })
  public record View(
      UUID id,
      UUID projectId,
      @Schema(types = {"string", "null"}) String styleCode,
      String name,
      @Schema(types = {"string", "null"}) String description,
      Status status,
      @Schema(minimum = "0") long version,
      Instant createdAt,
      Instant updatedAt) {}

  @Schema(
      name = "StylePage",
      requiredProperties = {"items", "limit", "offset", "hasMore"})
  public record Page(List<View> items, int limit, int offset, boolean hasMore) {}

  public record StyleContext(
      UUID organizationId,
      UUID projectId,
      UUID styleId,
      ParentStatus projectStatus,
      Status styleStatus) {}

  static class TextInput extends ValueDeserializer<String> {
    @Override
    public String deserialize(JsonParser parser, DeserializationContext context) {
      if (!parser.hasToken(JsonToken.VALUE_STRING)) throw ValidationRules.bad("Text required");
      return parser.getString();
    }
  }

  static class VersionInput extends ValueDeserializer<Long> {
    @Override
    public Long deserialize(JsonParser parser, DeserializationContext context) {
      if (!parser.hasToken(JsonToken.VALUE_NUMBER_INT))
        throw ValidationRules.bad("Integer version required");
      return parser.getLongValue();
    }
  }

  static class StatusInput extends ValueDeserializer<Status> {
    @Override
    public Status deserialize(JsonParser parser, DeserializationContext context) {
      if (!parser.hasToken(JsonToken.VALUE_STRING))
        throw ValidationRules.bad("Status code required");
      try {
        return Status.valueOf(parser.getString());
      } catch (IllegalArgumentException invalid) {
        throw ValidationRules.bad("Invalid status code");
      }
    }
  }

  private static final String COLUMNS =
      "id,project_id,style_code,name,description,status,version,created_at,updated_at";
  private static final RowMapper<View> ROW =
      (r, n) ->
          new View(
              r.getObject("id", UUID.class),
              r.getObject("project_id", UUID.class),
              r.getString("style_code"),
              r.getString("name"),
              r.getString("description"),
              Status.valueOf(r.getString("status")),
              r.getLong("version"),
              r.getTimestamp("created_at").toInstant(),
              r.getTimestamp("updated_at").toInstant());

  private final JdbcClient jdbc;
  private final ProjectService projects;
  private final AuditRecorder audit;

  public StyleService(JdbcClient jdbc, ProjectService projects, AuditRecorder audit) {
    this.jdbc = jdbc;
    this.projects = projects;
    this.audit = audit;
  }

  private View find(UUID project, UUID id, boolean lock) {
    return jdbc.sql(
            "SELECT "
                + COLUMNS
                + " FROM style WHERE id=:id AND project_id=:project"
                + (lock ? " FOR UPDATE" : ""))
        .param("id", id)
        .param("project", project)
        .query(ROW)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  @Transactional(readOnly = true)
  public View read(UUID org, UUID project, UUID id) {
    projects.readContext(org, project);
    return find(project, id, false);
  }

  @Transactional(readOnly = true)
  public StyleContext readContext(UUID org, UUID project, UUID id) {
    var parent = projects.readContext(org, project);
    var v = find(project, id, false);
    return new StyleContext(org, project, id, parentStatus(parent.status()), v.status());
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public StyleContext lockContextForWrite(UUID org, UUID project, UUID id) {
    var parent = projects.lockContextForWrite(org, project);
    var v = find(project, id, true);
    return new StyleContext(org, project, id, parentStatus(parent.status()), v.status());
  }

  @Transactional(readOnly = true)
  public Page list(UUID org, UUID project, Status status, int limit, int offset) {
    projects.readContext(org, project);
    ValidationRules.page(limit, offset);
    var rows =
        jdbc.sql(
                "SELECT "
                    + COLUMNS
                    + " FROM style WHERE project_id=:project"
                    + " AND (CAST(:status AS varchar) IS NULL OR status=:status)"
                    + " ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset")
            .param("project", project)
            .param("status", status == null ? null : status.name(), Types.VARCHAR)
            .param("limit", limit + 1)
            .param("offset", offset)
            .query(ROW)
            .list();
    return new Page(
        List.copyOf(rows.subList(0, Math.min(limit, rows.size()))),
        limit,
        offset,
        rows.size() > limit);
  }

  private String text(String value, int max, boolean required) {
    String result = value == null ? null : value.strip();
    if (result != null && result.isBlank()) result = null;
    if ((required && (result == null || result.isBlank()))
        || (result != null && result.length() > max))
      throw ValidationRules.bad("Invalid workspace text");
    return result;
  }

  private static ParentStatus parentStatus(ProjectService.Status status) {
    return switch (status) {
      case ACTIVE -> ParentStatus.ACTIVE;
      case ARCHIVED -> ParentStatus.ARCHIVED;
    };
  }

  private void active(ProjectService.Status status) {
    if (status != ProjectService.Status.ACTIVE) throw ValidationRules.conflict();
  }

  private Map<String, Object> state(View v) {
    return Map.of(
        "projectId",
        v.projectId(),
        "styleId",
        v.id(),
        "status",
        v.status().name(),
        "version",
        v.version());
  }

  @Transactional
  public View create(UUID org, UUID project, CreateInput body, String requestId) {
    var parent = projects.lockContextForWrite(org, project);
    active(parent.status());
    String name = text(body.name(), 160, true), description = text(body.description(), 4000, false);
    String code = text(body.styleCode(), 100, false);
    var created =
        jdbc.sql(
                "INSERT INTO style(id,project_id,style_code,name,description)"
                    + " VALUES(:id,:project,:code,:name,:description) RETURNING "
                    + COLUMNS)
            .param("id", UUID.randomUUID())
            .param("project", project)
            .param("code", code, Types.VARCHAR)
            .param("name", name)
            .param("description", description, Types.VARCHAR)
            .query(ROW)
            .single();
    audit.organizationChanged(
        org, "style.created", "Style", created.id(), requestId, null, state(created));
    return created;
  }

  @Transactional
  public View update(UUID org, UUID project, UUID id, UpdateInput body, String requestId) {
    var parent = projects.lockContextForWrite(org, project);
    var current = find(project, id, true);
    active(parent.status());
    if (body.version() == null || body.version() < 0) throw ValidationRules.bad("Version required");
    if (current.version() != body.version()) throw ValidationRules.conflict();
    if (body.status() == null) throw ValidationRules.bad("Status required");
    String name = text(body.name(), 160, true), description = text(body.description(), 4000, false);
    String code = text(body.styleCode(), 100, false), action;
    if (current.status() != body.status()) {
      if (!current.name().equals(name)
          || !Objects.equals(current.description(), description)
          || !Objects.equals(current.styleCode(), code))
        throw ValidationRules.bad("Lifecycle transition cannot change metadata");
      action = body.status() == Status.ARCHIVED ? "style.archived" : "style.reactivated";
    } else {
      if (current.status() == Status.ARCHIVED) throw ValidationRules.conflict();
      action = "style.updated";
    }
    var updated =
        jdbc.sql(
                "UPDATE style SET"
                    + " style_code=:code,name=:name,description=:description,status=:status,version=version+1,updated_at=now()"
                    + " WHERE id=:id AND project_id=:project AND version=:version RETURNING "
                    + COLUMNS)
            .param("code", code, Types.VARCHAR)
            .param("name", name)
            .param("description", description, Types.VARCHAR)
            .param("status", body.status().name())
            .param("id", id)
            .param("project", project)
            .param("version", body.version())
            .query(ROW)
            .optional()
            .orElseThrow(ValidationRules::conflict);
    audit.organizationChanged(org, action, "Style", id, requestId, state(current), state(updated));
    return updated;
  }
}
