package com.sourceos.pattern;

import com.sourceos.shared.ValidationRules;
import com.sourceos.style.StyleService;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

/** Authorized immutable metadata provider; no QA dependency or storage IO. */
@Service
public class PatternQaContext {
  public record Context(UUID patternId, UUID revisionId, UUID styleId, long revisionNumber) {}

  private final StyleService styles;
  private final JdbcClient jdbc;

  public PatternQaContext(StyleService styles, JdbcClient jdbc) {
    this.styles = styles;
    this.jdbc = jdbc;
  }

  @Transactional(readOnly = true)
  public Context read(UUID org, UUID project, UUID style, UUID pattern, UUID revision) {
    styles.readContext(org, project, style);
    return resolve(style, pattern, revision);
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public Context lockForAssessment(
      UUID org, UUID project, UUID style, UUID pattern, UUID revision, UUID artifact) {
    var parents = styles.lockContextForWrite(org, project, style);
    if (parents.projectStatus() != StyleService.ParentStatus.ACTIVE
        || parents.styleStatus() != StyleService.Status.ACTIVE) throw ValidationRules.conflict();
    String status =
        jdbc.sql("SELECT status FROM pattern WHERE id=:id AND style_id=:style FOR UPDATE")
            .param("id", pattern)
            .param("style", style)
            .query(String.class)
            .optional()
            .orElseThrow(ValidationRules::missing);
    if (!status.equals("ACTIVE")) throw ValidationRules.conflict();
    var context = resolve(style, pattern, revision);
    if (artifact != null) {
      String state =
          jdbc.sql(
                  "SELECT state FROM pattern_artifact WHERE id=:id AND"
                      + " pattern_revision_id=:revision AND style_id=:style")
              .param("id", artifact)
              .param("revision", revision)
              .param("style", style)
              .query(String.class)
              .optional()
              .orElseThrow(ValidationRules::missing);
      if (!state.equals("READY")) throw ValidationRules.conflict();
    }
    return context;
  }

  private Context resolve(UUID style, UUID pattern, UUID revision) {
    return jdbc.sql(
            "SELECT r.revision_number FROM pattern p JOIN pattern_revision r ON r.pattern_id=p.id"
                + " AND r.style_id=p.style_id WHERE p.id=:pattern AND p.style_id=:style AND"
                + " r.id=:revision")
        .param("pattern", pattern)
        .param("style", style)
        .param("revision", revision)
        .query((r, n) -> new Context(pattern, revision, style, r.getLong(1)))
        .optional()
        .orElseThrow(ValidationRules::missing);
  }
}
