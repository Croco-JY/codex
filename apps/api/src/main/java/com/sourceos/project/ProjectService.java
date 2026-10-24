package com.sourceos.project;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.authorization.OrganizationAuthorization;
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
public class ProjectService {
  public enum Status {
    ACTIVE,
    ARCHIVED
  }

  @Schema(
      name = "ProjectCreateInput",
      requiredProperties = {"name"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record CreateInput(
      @Schema(maxLength = 160, minLength = 1) @JsonDeserialize(using = TextInput.class) String name,
      @Schema(
              types = {"string", "null"},
              maxLength = 4000)
          @JsonDeserialize(using = TextInput.class)
          String description) {}

  @Schema(
      name = "ProjectUpdateInput",
      requiredProperties = {"name", "status", "version"},
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record UpdateInput(
      @Schema(maxLength = 160, minLength = 1) @JsonDeserialize(using = TextInput.class) String name,
      @Schema(
              types = {"string", "null"},
              maxLength = 4000)
          @JsonDeserialize(using = TextInput.class)
          String description,
      @JsonDeserialize(using = StatusInput.class) Status status,
      @Schema(minimum = "0") @JsonDeserialize(using = VersionInput.class) Long version) {}

  @Schema(
      name = "ProjectView",
      requiredProperties = {
        "id",
        "organizationId",
        "name",
        "description",
        "status",
        "version",
        "createdAt",
        "updatedAt"
      })
  public record View(
      UUID id,
      UUID organizationId,
      String name,
      @Schema(types = {"string", "null"}) String description,
      Status status,
      @Schema(minimum = "0") long version,
      Instant createdAt,
      Instant updatedAt) {}

  @Schema(
      name = "ProjectPage",
      requiredProperties = {"items", "limit", "offset", "hasMore"})
  public record Page(List<View> items, int limit, int offset, boolean hasMore) {}

  /** Immutable application context; no persistence objects cross module boundaries. */
  public record ProjectContext(UUID projectId, UUID organizationId, Status status) {}

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
      "id,organization_id,name,description,status,version,created_at,updated_at";
  private static final RowMapper<View> ROW =
      (r, n) ->
          new View(
              r.getObject("id", UUID.class),
              r.getObject("organization_id", UUID.class),
              r.getString("name"),
              r.getString("description"),
              Status.valueOf(r.getString("status")),
              r.getLong("version"),
              r.getTimestamp("created_at").toInstant(),
              r.getTimestamp("updated_at").toInstant());

  private final JdbcClient jdbc;
  private final OrganizationAuthorization authorization;
  private final AuditRecorder audit;

  public ProjectService(
      JdbcClient jdbc, OrganizationAuthorization authorization, AuditRecorder audit) {
    this.jdbc = jdbc;
    this.authorization = authorization;
    this.audit = audit;
  }

  private View find(UUID org, UUID id, boolean lock) {
    return jdbc.sql(
            "SELECT "
                + COLUMNS
                + " FROM project WHERE id=:id AND organization_id=:org"
                + (lock ? " FOR UPDATE" : ""))
        .param("id", id)
        .param("org", org)
        .query(ROW)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  @Transactional(readOnly = true)
  public View read(UUID org, UUID id) {
    authorization.requireRead(org);
    return find(org, id, false);
  }

  @Transactional(readOnly = true)
  public ProjectContext readContext(UUID org, UUID id) {
    authorization.requireRead(org);
    var v = find(org, id, false);
    return new ProjectContext(v.id(), v.organizationId(), v.status());
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public ProjectContext lockContextForWrite(UUID org, UUID id) {
    authorization.requireWrite(org);
    var v = find(org, id, true);
    return new ProjectContext(v.id(), v.organizationId(), v.status());
  }

  @Transactional(readOnly = true)
  public Page list(UUID org, Status status, int limit, int offset) {
    authorization.requireRead(org);
    ValidationRules.page(limit, offset);
    var rows =
        jdbc.sql(
                "SELECT "
                    + COLUMNS
                    + " FROM project WHERE organization_id=:org"
                    + " AND (CAST(:status AS varchar) IS NULL OR status=:status)"
                    + " ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset")
            .param("org", org)
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

  private Map<String, Object> state(View v) {
    return Map.of("projectId", v.id(), "status", v.status().name(), "version", v.version());
  }

  @Transactional
  public View create(UUID org, CreateInput body, String requestId) {
    authorization.requireWrite(org);
    String name = text(body.name(), 160, true), description = text(body.description(), 4000, false);
    var created =
        jdbc.sql(
                "INSERT INTO project(id,organization_id,name,description)"
                    + " VALUES(:id,:org,:name,:description) RETURNING "
                    + COLUMNS)
            .param("id", UUID.randomUUID())
            .param("org", org)
            .param("name", name)
            .param("description", description, Types.VARCHAR)
            .query(ROW)
            .single();
    audit.organizationChanged(
        org, "project.created", "Project", created.id(), requestId, null, state(created));
    return created;
  }

  @Transactional
  public View update(UUID org, UUID id, UpdateInput body, String requestId) {
    authorization.requireWrite(org);
    var current = find(org, id, true);
    if (body.version() == null || body.version() < 0) throw ValidationRules.bad("Version required");
    if (current.version() != body.version()) throw ValidationRules.conflict();
    if (body.status() == null) throw ValidationRules.bad("Status required");
    String name = text(body.name(), 160, true), description = text(body.description(), 4000, false);
    String action;
    if (current.status() != body.status()) {
      if (!current.name().equals(name) || !Objects.equals(current.description(), description))
        throw ValidationRules.bad("Lifecycle transition cannot change metadata");
      action = body.status() == Status.ARCHIVED ? "project.archived" : "project.reactivated";
    } else {
      if (current.status() == Status.ARCHIVED) throw ValidationRules.conflict();
      action = "project.updated";
    }
    var updated =
        jdbc.sql(
                "UPDATE project SET"
                    + " name=:name,description=:description,status=:status,version=version+1,updated_at=now()"
                    + " WHERE id=:id AND organization_id=:org AND version=:version RETURNING "
                    + COLUMNS)
            .param("name", name)
            .param("description", description, Types.VARCHAR)
            .param("status", body.status().name())
            .param("id", id)
            .param("org", org)
            .param("version", body.version())
            .query(ROW)
            .optional()
            .orElseThrow(ValidationRules::conflict);
    audit.organizationChanged(
        org, action, "Project", id, requestId, state(current), state(updated));
    return updated;
  }
}
