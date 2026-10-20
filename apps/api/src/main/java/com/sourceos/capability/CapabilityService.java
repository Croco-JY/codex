package com.sourceos.capability;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.authorization.PlatformAuthorization;
import com.sourceos.shared.ValidationRules;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CapabilityService {
  public enum Category {
    PRODUCT,
    MATERIAL_HANDLING,
    PROCESS
  }

  @io.swagger.v3.oas.annotations.media.Schema(name = "CapabilityInput")
  public record Input(
      @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{0,79}") String code,
      UUID parentId,
      @NotNull Category category,
      @NotBlank @Size(max = 160) String nameEn,
      @Size(max = 160) String nameLocal,
      @Size(max = 4000) String description,
      boolean active,
      @Min(0) long version) {}

  @io.swagger.v3.oas.annotations.media.Schema(name = "CapabilityView")
  public record View(
      UUID id,
      String code,
      UUID parentId,
      Category category,
      String nameEn,
      String nameLocal,
      String description,
      boolean active,
      long version) {}

  private final JdbcClient jdbc;
  private final PlatformAuthorization auth;
  private final AuditRecorder audit;

  public CapabilityService(JdbcClient jdbc, PlatformAuthorization auth, AuditRecorder audit) {
    this.jdbc = jdbc;
    this.auth = auth;
    this.audit = audit;
  }

  public List<View> list() {
    return list(100, 0);
  }

  public List<View> list(int limit, int offset) {
    ValidationRules.page(limit, offset);
    return jdbc.sql("SELECT * FROM capability ORDER BY code LIMIT :limit OFFSET :offset")
        .param("limit", limit)
        .param("offset", offset)
        .query(
            (rs, n) ->
                new View(
                    rs.getObject("id", UUID.class),
                    rs.getString("code"),
                    rs.getObject("parent_id", UUID.class),
                    Category.valueOf(rs.getString("category")),
                    rs.getString("name_en"),
                    rs.getString("name_local"),
                    rs.getString("description"),
                    rs.getBoolean("active"),
                    rs.getLong("version")))
        .list();
  }

  @Transactional
  public UUID save(UUID id, Input v) {
    auth.requireAdmin();
    boolean create = id == null;
    UUID key = create ? UUID.randomUUID() : id;
    String sql =
        create
            ? "INSERT INTO"
                + " capability(id,code,parent_id,category,name_en,name_local,description,active)"
                + " VALUES(:id,:code,:parent,:category,:name,:local,:description,:active)"
            : "UPDATE capability SET"
                  + " code=:code,parent_id=:parent,category=:category,name_en=:name,name_local=:local,description=:description,active=:active,version=version+1,updated_at=now()"
                  + " WHERE id=:id AND version=:version";
    var q =
        jdbc.sql(sql)
            .param("id", key)
            .param("code", v.code())
            .param("parent", v.parentId())
            .param("category", v.category().name())
            .param("name", v.nameEn())
            .param("local", v.nameLocal())
            .param("description", v.description())
            .param("active", v.active());
    if (!create) q.param("version", v.version());
    if (q.update() != 1) throw ValidationRules.conflict();
    audit.changed(
        create ? "capability.created" : "capability.updated",
        "Capability",
        key,
        null,
        Map.of("name", v.nameEn()));
    return key;
  }
}
