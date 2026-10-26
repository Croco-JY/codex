package com.sourceos.grading;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.grading.GradingModels.*;
import com.sourceos.identity.IdentityService;
import com.sourceos.shared.Keysets;
import com.sourceos.shared.ValidationRules;
import com.sourceos.style.StyleService;
import java.math.BigDecimal;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GradingService {
  public static final long MAX = 9007199254740991L;
  private final JdbcClient jdbc;
  private final StyleService styles;
  private final IdentityService identities;
  private final AuditRecorder audit;

  public GradingService(
      JdbcClient jdbc, StyleService styles, IdentityService identities, AuditRecorder audit) {
    this.jdbc = jdbc;
    this.styles = styles;
    this.identities = identities;
    this.audit = audit;
  }

  private record Aggregate(
      UUID id, UUID styleId, Status status, long version, Instant createdAt, Instant updatedAt) {}

  private static final RowMapper<Aggregate> AGG =
      (r, n) ->
          new Aggregate(
              r.getObject("id", UUID.class),
              r.getObject("style_id", UUID.class),
              Status.valueOf(r.getString("status")),
              r.getLong("version"),
              r.getTimestamp("created_at").toInstant(),
              r.getTimestamp("updated_at").toInstant());

  private static RevisionSummary summary(ResultSet r) throws SQLException {
    return new RevisionSummary(
        r.getObject("id", UUID.class),
        r.getObject("grade_rule_set_id", UUID.class),
        r.getObject("style_id", UUID.class),
        r.getLong("revision_number"),
        r.getString("name"),
        r.getString("base_size_code"),
        Unit.valueOf(r.getString("unit_system")),
        r.getInt("size_count"),
        r.getInt("rule_count"),
        r.getTimestamp("created_at").toInstant());
  }

  private static final String COUNTS =
      "(SELECT count(*) FROM grade_size s WHERE s.revision_id=r.id) AS size_count,"
          + "(SELECT count(*) FROM grade_rule g WHERE g.revision_id=r.id) AS rule_count";

  private Aggregate find(UUID style, UUID id, boolean lock) {
    return jdbc.sql(
            "SELECT * FROM grade_rule_set WHERE style_id=:style AND id=:id"
                + (lock ? " FOR UPDATE" : ""))
        .param("style", style)
        .param("id", id)
        .query(AGG)
        .optional()
        .orElseThrow(ValidationRules::missing);
  }

  private RevisionSummary latest(UUID id) {
    return jdbc.sql(
            "SELECT r.*,"
                + COUNTS
                + " FROM grade_rule_set_revision r WHERE grade_rule_set_id=:id"
                + " ORDER BY revision_number DESC LIMIT 1")
        .param("id", id)
        .query((r, n) -> summary(r))
        .optional()
        .orElseThrow(() -> new IllegalStateException("Incomplete grading aggregate"));
  }

  private void active(UUID org, UUID project, UUID style) {
    var c = styles.lockContextForWrite(org, project, style);
    if (c.projectStatus() != StyleService.ParentStatus.ACTIVE
        || c.styleStatus() != StyleService.Status.ACTIVE) throw ValidationRules.conflict();
  }

  public static CreateInput validated(CreateInput input) {
    if (input == null
        || input.unitSystem() == null
        || input.sizes() == null
        || input.rules() == null
        || input.sizes().size() < 2
        || input.sizes().size() > 30
        || input.rules().isEmpty()
        || input.rules().size() > 100)
      throw ValidationRules.bad("A complete grading snapshot is required");
    var codes = new HashSet<String>();
    var sizes = new ArrayList<SizeInput>();
    for (var s : input.sizes()) {
      if (s == null
          || s.code() == null
          || !s.code().matches("[A-Z0-9][A-Z0-9._/-]{0,39}")
          || !codes.add(s.code())) throw ValidationRules.bad("Invalid or duplicate size code");
      sizes.add(new SizeInput(s.code(), GradingText.canonical(s.label(), 80, false)));
    }
    if (!codes.contains(input.baseSizeCode())) throw ValidationRules.bad("Base size must exist");
    codes.clear();
    var rules = new ArrayList<RuleInput>();
    for (var r : input.rules()) {
      if (r == null
          || r.code() == null
          || !r.code().matches("[A-Z0-9][A-Z0-9._/-]{0,79}")
          || !codes.add(r.code())
          || r.values() == null
          || r.values().size() != sizes.size())
        throw ValidationRules.bad("Invalid or duplicate rule or incomplete matrix");
      var values = new ArrayList<ValueInput>();
      for (int i = 0; i < sizes.size(); i++) {
        var v = r.values().get(i);
        if (v == null
            || !sizes.get(i).code().equals(v.sizeCode())
            || v.delta() == null
            || v.delta().scale() < 0
            || v.delta().scale() > 4
            || v.delta().precision() - v.delta().scale() > 15)
          throw ValidationRules.bad("Invalid matrix order or exact decimal");
        if (v.sizeCode().equals(input.baseSizeCode()) && v.delta().compareTo(BigDecimal.ZERO) != 0)
          throw ValidationRules.bad("Base size delta must be mathematical zero");
        values.add(v);
      }
      rules.add(
          new RuleInput(
              r.code(),
              GradingText.canonical(r.label(), 160, false),
              GradingText.canonical(r.notes(), 1000, true),
              List.copyOf(values)));
    }
    return new CreateInput(
        GradingText.canonical(input.name(), 160, false),
        input.baseSizeCode(),
        input.unitSystem(),
        GradingText.canonical(input.notes(), 1000, true),
        List.copyOf(sizes),
        List.copyOf(rules));
  }

  private RevisionView revision(UUID style, UUID parent, UUID id) {
    var metadata =
        jdbc.sql(
                "SELECT r.*,"
                    + COUNTS
                    + " FROM grade_rule_set_revision r"
                    + " WHERE id=:id AND grade_rule_set_id=:parent AND style_id=:style")
            .param("id", id)
            .param("parent", parent)
            .param("style", style)
            .query(
                (r, n) -> new AbstractMap.SimpleImmutableEntry<>(summary(r), r.getString("notes")))
            .optional()
            .orElseThrow(ValidationRules::missing);
    var sizes =
        jdbc.sql(
                "SELECT position,code,label FROM grade_size WHERE revision_id=:id ORDER BY"
                    + " position")
            .param("id", id)
            .query((r, n) -> new SizeView(r.getInt(1), r.getString(2), r.getString(3)))
            .list();
    var rules =
        jdbc.sql(
                "SELECT position,code,label,notes FROM grade_rule WHERE revision_id=:id ORDER BY"
                    + " position")
            .param("id", id)
            .query(
                (r, n) ->
                    new RuleView(
                        r.getInt(1), r.getString(2), r.getString(3), r.getString(4), List.of()))
            .list();
    var values = new LinkedHashMap<String, List<ValueView>>();
    jdbc.sql(
            "SELECT v.rule_code,v.size_code,v.delta FROM grade_rule_value v"
                + " JOIN grade_rule r ON r.revision_id=v.revision_id AND r.code=v.rule_code"
                + " JOIN grade_size s ON s.revision_id=v.revision_id AND s.code=v.size_code"
                + " WHERE v.revision_id=:id ORDER BY r.position,s.position")
        .param("id", id)
        .query(
            (r, n) -> {
              values
                  .computeIfAbsent(r.getString(1), ignored -> new ArrayList<>())
                  .add(new ValueView(r.getString(2), r.getBigDecimal(3)));
              return 0;
            })
        .list();
    var m = metadata.getKey();
    return new RevisionView(
        m.id(),
        m.gradeRuleSetId(),
        m.styleId(),
        m.revisionNumber(),
        m.name(),
        m.baseSizeCode(),
        m.unitSystem(),
        metadata.getValue(),
        m.createdAt(),
        List.copyOf(sizes),
        rules.stream()
            .map(
                r ->
                    new RuleView(
                        r.position(),
                        r.code(),
                        r.label(),
                        r.notes(),
                        List.copyOf(values.get(r.code()))))
            .toList());
  }

  private View view(Aggregate a, RevisionView r) {
    return new View(a.id(), a.styleId(), a.status(), a.version(), a.createdAt(), a.updatedAt(), r);
  }

  @Transactional(readOnly = true)
  public View read(UUID org, UUID project, UUID style, UUID id) {
    styles.readContext(org, project, style);
    var a = find(style, id, false);
    return view(a, revision(style, id, latest(id).id()));
  }

  @Transactional(readOnly = true)
  public RevisionView readRevision(UUID org, UUID project, UUID style, UUID id, UUID revision) {
    styles.readContext(org, project, style);
    find(style, id, false);
    return revision(style, id, revision);
  }

  @Transactional(readOnly = true)
  public Page list(UUID org, UUID project, UUID style, Filter filter, int limit, String cursor) {
    styles.readContext(org, project, style);
    if (filter == null) throw ValidationRules.bad("Filter required");
    var context = List.of("grade-rule-sets", org, project, style, filter);
    var anchor = Keysets.anchor(cursor, context, limit);
    var rows =
        jdbc.sql(
                "SELECT p.id AS aggregate_id,p.status,p.version,p.created_at AS aggregate_created,"
                    + "p.updated_at,r.*,"
                    + COUNTS
                    + " FROM grade_rule_set p LEFT JOIN LATERAL (SELECT * FROM"
                    + " grade_rule_set_revision WHERE grade_rule_set_id=p.id ORDER BY"
                    + " revision_number DESC LIMIT 1) r ON true WHERE p.style_id=:style AND"
                    + " (:filter='ALL' OR p.status=:filter) AND (CAST(:at AS timestamptz) IS NULL"
                    + " OR (p.created_at,p.id)<(:at,:anchor)) ORDER BY p.created_at DESC,p.id DESC"
                    + " LIMIT :limit")
            .param("style", style)
            .param("filter", filter.name())
            .param("at", Keysets.time(anchor.at()), Types.TIMESTAMP_WITH_TIMEZONE)
            .param("anchor", anchor.id(), Types.OTHER)
            .param("limit", limit + 1)
            .query(
                (r, n) -> {
                  if (r.getObject("id") == null)
                    throw new IllegalStateException("Incomplete grading aggregate");
                  return new ListItem(
                      r.getObject("aggregate_id", UUID.class),
                      r.getObject("style_id", UUID.class),
                      Status.valueOf(r.getString("status")),
                      r.getLong("version"),
                      r.getTimestamp("aggregate_created").toInstant(),
                      r.getTimestamp("updated_at").toInstant(),
                      summary(r));
                })
            .list();
    var page = Keysets.page(rows, limit, context, ListItem::createdAt, ListItem::id);
    return new Page(page.items(), limit, page.nextCursor());
  }

  @Transactional(readOnly = true)
  public RevisionPage history(UUID org, UUID project, UUID style, UUID id, int limit, Long max) {
    styles.readContext(org, project, style);
    find(style, id, false);
    Keysets.limit(limit);
    if (max != null && (max < 1 || max > MAX)) throw ValidationRules.bad("Invalid revision bound");
    var rows =
        jdbc.sql(
                "SELECT r.*,"
                    + COUNTS
                    + " FROM grade_rule_set_revision r WHERE grade_rule_set_id=:id"
                    + " AND revision_number<=:max ORDER BY revision_number DESC LIMIT :limit")
            .param("id", id)
            .param("max", max == null ? MAX : max)
            .param("limit", limit + 1)
            .query((r, n) -> summary(r))
            .list();
    return new RevisionPage(
        List.copyOf(rows.subList(0, Math.min(limit, rows.size()))),
        limit,
        rows.size() > limit ? rows.get(limit).revisionNumber() : null);
  }

  @Transactional
  public View create(UUID org, UUID project, UUID style, CreateInput raw, String request) {
    active(org, project, style);
    var input = validated(raw);
    var a =
        jdbc.sql("INSERT INTO grade_rule_set(id,style_id) VALUES(:id,:style) RETURNING *")
            .param("id", UUID.randomUUID())
            .param("style", style)
            .query(AGG)
            .single();
    var r = construct(a, 1, input);
    audit.organizationChanged(
        org, "grade_rule_set.created", "GradeRuleSet", a.id(), request, null, state(a));
    record(org, r, request);
    return view(a, r);
  }

  @Transactional
  public RevisionView createRevision(
      UUID org, UUID project, UUID style, UUID id, RevisionInput input, String request) {
    active(org, project, style);
    var a = find(style, id, true);
    if (a.status() != Status.ACTIVE) throw ValidationRules.conflict();
    if (input == null
        || input.expectedLatestRevisionNumber() == null
        || input.expectedLatestRevisionNumber() < 1
        || input.expectedLatestRevisionNumber() > MAX)
      throw ValidationRules.bad("Revision baseline required");
    long current = latest(id).revisionNumber();
    if (current != input.expectedLatestRevisionNumber() || current == MAX)
      throw ValidationRules.conflict();
    var r = construct(a, current + 1, validated(input.snapshot()));
    record(org, r, request);
    return r;
  }

  @Transactional
  public LifecycleView lifecycle(
      UUID org, UUID project, UUID style, UUID id, LifecycleInput input, String request) {
    active(org, project, style);
    var a = find(style, id, true);
    if (input == null
        || input.status() == null
        || input.version() == null
        || input.version() < 0
        || input.version() > MAX)
      throw ValidationRules.bad("Lifecycle status and version required");
    if (a.version() != input.version()) throw ValidationRules.conflict();
    if (a.status() != input.status()) {
      if (a.version() == MAX) throw ValidationRules.conflict();
      var after =
          jdbc.sql(
                  "UPDATE grade_rule_set SET"
                      + " status=:status,version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at+interval"
                      + " '1 microsecond') WHERE id=:id RETURNING *")
              .param("status", input.status().name())
              .param("id", id)
              .query(AGG)
              .single();
      audit.organizationChanged(
          org,
          input.status() == Status.ARCHIVED
              ? "grade_rule_set.archived"
              : "grade_rule_set.reactivated",
          "GradeRuleSet",
          id,
          request,
          state(a),
          state(after));
      a = after;
    }
    return new LifecycleView(
        a.id(), a.styleId(), a.status(), a.version(), a.createdAt(), a.updatedAt(), latest(id));
  }

  private void rows(String table, String columns, String tuple, List<Object> args, int count) {
    jdbc.sql(
            "INSERT INTO "
                + table
                + "("
                + columns
                + ") VALUES "
                + String.join(",", Collections.nCopies(count, tuple)))
        .params(args.toArray())
        .update();
  }

  private RevisionView construct(Aggregate a, long number, CreateInput input) {
    UUID id = UUID.randomUUID();
    var actor = identities.current();
    jdbc.sql(
            "INSERT INTO"
                + " grade_rule_set_revision(id,grade_rule_set_id,style_id,revision_number,name,base_size_code,unit_system,notes,created_by_issuer,created_by_subject)"
                + " VALUES(:id,:parent,:style,:number,:name,:base,:unit,:notes,:issuer,:subject)")
        .param("id", id)
        .param("parent", a.id())
        .param("style", a.styleId())
        .param("number", number)
        .param("name", input.name())
        .param("base", input.baseSizeCode())
        .param("unit", input.unitSystem().name())
        .param("notes", input.notes(), Types.VARCHAR)
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .update();
    var sizes = new ArrayList<Object>();
    for (int i = 0; i < input.sizes().size(); i++) {
      var s = input.sizes().get(i);
      Collections.addAll(sizes, id, i, s.code(), s.label());
    }
    rows("grade_size", "revision_id,position,code,label", "(?,?,?,?)", sizes, input.sizes().size());
    var rules = new ArrayList<Object>();
    var values = new ArrayList<Object>();
    for (int i = 0; i < input.rules().size(); i++) {
      var r = input.rules().get(i);
      Collections.addAll(rules, id, i, r.code(), r.label(), r.notes());
      for (var v : r.values()) Collections.addAll(values, id, r.code(), v.sizeCode(), v.delta());
    }
    rows(
        "grade_rule",
        "revision_id,position,code,label,notes",
        "(?,?,?,?,?)",
        rules,
        input.rules().size());
    rows(
        "grade_rule_value",
        "revision_id,rule_code,size_code,delta",
        "(?,?,?,?)",
        values,
        input.rules().size() * input.sizes().size());
    jdbc.sql("UPDATE grade_rule_set_revision SET sealed=true WHERE id=:id")
        .param("id", id)
        .update();
    return revision(a.styleId(), a.id(), id);
  }

  private Map<String, Object> state(Aggregate a) {
    return Map.of("styleId", a.styleId(), "status", a.status().name(), "version", a.version());
  }

  private void record(UUID org, RevisionView r, String request) {
    audit.organizationChanged(
        org,
        "grade_rule_set_revision.created",
        "GradeRuleSetRevision",
        r.id(),
        request,
        null,
        Map.of(
            "styleId",
            r.styleId(),
            "gradeRuleSetId",
            r.gradeRuleSetId(),
            "gradeRuleSetRevisionNumber",
            r.revisionNumber(),
            "gradeSizeCount",
            r.sizes().size(),
            "gradeRuleCount",
            r.rules().size()));
  }
}
