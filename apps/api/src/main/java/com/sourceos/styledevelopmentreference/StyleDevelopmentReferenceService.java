package com.sourceos.styledevelopmentreference;

import com.sourceos.file.AuthorizedStorage;
import com.sourceos.shared.ValidationRules;
import com.sourceos.style.StyleService;
import io.swagger.v3.oas.annotations.media.Schema;
import java.io.IOException;
import java.nio.file.NoSuchFileException;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@Service
public class StyleDevelopmentReferenceService {
  @Schema(name = "StyleDevelopmentReferenceState", enumAsRef = true)
  public enum State {
    PENDING,
    READY,
    FAILED,
    DETACHED
  }

  @Schema(
      name = "StyleDevelopmentReferenceView",
      requiredProperties = {
        "id",
        "styleId",
        "storageObjectId",
        "displayName",
        "mediaType",
        "sizeBytes",
        "state",
        "version",
        "createdAt",
        "updatedAt"
      })
  public record View(
      UUID id,
      UUID styleId,
      UUID storageObjectId,
      String displayName,
      @Schema(allowableValues = "application/octet-stream") String mediaType,
      @Schema(minimum = "1", maximum = "10485760") long sizeBytes,
      State state,
      @Schema(minimum = "0") long version,
      Instant createdAt,
      Instant updatedAt) {}

  @Schema(
      name = "StyleDevelopmentReferencePage",
      requiredProperties = {"items", "limit", "offset", "hasMore"})
  public record Page(List<View> items, int limit, int offset, boolean hasMore) {}

  public record Content(View metadata, byte[] bytes) {}

  static final String COLUMNS =
      "id,style_id,storage_object_id,display_name,media_type,size_bytes,state,version,created_at,updated_at";
  static final RowMapper<View> ROW =
      (r, n) ->
          new View(
              r.getObject("id", UUID.class),
              r.getObject("style_id", UUID.class),
              r.getObject("storage_object_id", UUID.class),
              r.getString("display_name"),
              r.getString("media_type"),
              r.getLong("size_bytes"),
              State.valueOf(r.getString("state")),
              r.getLong("version"),
              r.getTimestamp("created_at").toInstant(),
              r.getTimestamp("updated_at").toInstant());
  private final JdbcClient jdbc;
  private final StyleService styles;
  private final AuthorizedStorage storage;
  private final StyleDevelopmentReferenceTransactions transactions;
  private static final org.slf4j.Logger LOG =
      org.slf4j.LoggerFactory.getLogger(StyleDevelopmentReferenceService.class);

  public StyleDevelopmentReferenceService(
      JdbcClient jdbc,
      StyleService styles,
      AuthorizedStorage storage,
      StyleDevelopmentReferenceTransactions transactions) {
    this.jdbc = jdbc;
    this.styles = styles;
    this.storage = storage;
    this.transactions = transactions;
  }

  static String safeName(String value) {
    if (value == null) throw ValidationRules.bad("Display name required");
    String name = value.strip();
    if (name.isEmpty()
        || name.length() > 255
        || name.equals(".")
        || name.equals("..")
        || name.indexOf('/') >= 0
        || name.indexOf('\\') >= 0
        || name.codePoints().anyMatch(Character::isISOControl))
      throw ValidationRules.bad("Invalid display name");
    return name;
  }

  @Transactional(readOnly = true)
  public Page list(UUID org, UUID project, UUID style, State state, int limit, int offset) {
    styles.readContext(org, project, style);
    ValidationRules.page(limit, offset);
    var rows =
        jdbc.sql(
                "SELECT "
                    + COLUMNS
                    + " FROM style_development_reference WHERE style_id=:style"
                    + (state == null ? "" : " AND state=:state")
                    + " ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset")
            .params(
                state == null
                    ? Map.of("style", style, "limit", limit + 1, "offset", offset)
                    : Map.of(
                        "style",
                        style,
                        "state",
                        state.name(),
                        "limit",
                        limit + 1,
                        "offset",
                        offset))
            .query(ROW)
            .list();
    return new Page(
        List.copyOf(rows.subList(0, Math.min(limit, rows.size()))),
        limit,
        offset,
        rows.size() > limit);
  }

  @Transactional(readOnly = true)
  public View read(UUID org, UUID project, UUID style, UUID reference) {
    styles.readContext(org, project, style);
    return jdbc.sql(
            "SELECT "
                + COLUMNS
                + " FROM style_development_reference WHERE style_id=:style AND id=:id")
        .param("style", style)
        .param("id", reference)
        .query(ROW)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  /** NEVER span storage IO with a SQL transaction. The separate bean commits each phase. */
  @Transactional(propagation = Propagation.NEVER)
  public View upload(
      UUID org, UUID project, UUID style, String displayName, byte[] bytes, String requestId) {
    if (bytes.length < 1) throw ValidationRules.bad("Empty file");
    if (bytes.length > AuthorizedStorage.MAX_BYTES)
      throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "File too large");
    String name = safeName(displayName);
    var reserved = transactions.reserve(org, project, style, name, bytes.length, requestId);
    try {
      storage.putNew(org, reserved.storageObjectId(), bytes);
    } catch (IOException storageFailure) {
      try {
        transactions.finish(org, project, style, reserved.id(), State.FAILED, requestId);
      } catch (RuntimeException blocked) {
        LOG.warn(
            "Development reference failure recording blocked: org={} style={} reference={}"
                + " request={}",
            org,
            style,
            reserved.id(),
            requestId);
      }
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "Attachment storage failed");
    }
    return transactions.finish(org, project, style, reserved.id(), State.READY, requestId);
  }

  public View detach(
      UUID org, UUID project, UUID style, UUID reference, long version, String requestId) {
    return transactions.detach(org, project, style, reference, version, requestId);
  }

  public Content content(UUID org, UUID project, UUID style, UUID reference, String requestId)
      throws IOException {
    var view = read(org, project, style, reference);
    if (view.state() != State.READY) throw ValidationRules.conflict();
    byte[] bytes;
    try {
      bytes = storage.get(org, view.storageObjectId());
    } catch (NoSuchFileException missing) {
      LOG.warn(
          "Development reference content missing: org={} reference={} object={} request={}",
          org,
          reference,
          view.storageObjectId(),
          requestId);
      throw ValidationRules.missing();
    }
    if (bytes.length != view.sizeBytes()) {
      LOG.warn(
          "Development reference size mismatch: org={} reference={} object={} expected={} actual={}"
              + " request={}",
          org,
          reference,
          view.storageObjectId(),
          view.sizeBytes(),
          bytes.length,
          requestId);
      throw ValidationRules.conflict();
    }
    return new Content(view, bytes);
  }
}
