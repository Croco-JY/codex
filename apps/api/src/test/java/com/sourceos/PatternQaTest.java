package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.sourceos.patternqa.PatternQaModels.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class PatternQaTest extends PatternQaSupport {
  @Test
  void actualForeignRevisionAssessmentAndArtifactRemainScoped() throws Exception {
    actor(foreignOwner);
    var other =
        patterns.create(
            foreignOrg,
            foreignProject.id(),
            foreignStyle.id(),
            new com.sourceos.pattern.PatternService.CreateInput("Foreign QA private", null, null),
            "foreign-qa");
    var foreign =
        qa.create(
            foreignOrg,
            foreignProject.id(),
            foreignStyle.id(),
            other.id(),
            other.latestRevision().id(),
            assessment(0),
            "foreign-qa");
    String own = qaPath(family.latestRevision().id());
    problem(
        request(
            "GET",
            own.replace(
                family.latestRevision().id().toString(), other.latestRevision().id().toString()),
            owner,
            null),
        404);
    problem(request("GET", own + "/assessments/" + foreign.id(), owner, null), 404);
    String foreignPath =
        "/api/v1/organizations/"
            + foreignOrg
            + "/projects/"
            + foreignProject.id()
            + "/styles/"
            + foreignStyle.id()
            + "/patterns/"
            + other.id()
            + "/revisions/"
            + other.latestRevision().id()
            + "/qa";
    problem(request("GET", foreignPath, owner, null), 403);
    membership(foreignOrg, owner, "ORG_OWNER", "ACTIVE");
    problem(
        request(
            "GET",
            foreignPath.replace(foreignProject.id().toString(), project.id().toString()),
            owner,
            null),
        404);
    var ready = upload();
    var body = qaBody(0);
    body.put("evidenceBasis", "READY_ARTIFACT");
    body.put("artifactId", ready.artifact().id());
    problem(request("POST", own + "/assessments", owner, body), 404);
    assertThat(qaAudits()).isZero();
  }

  @Test
  void generatedQaContractHasFourOperationsAndRequiredNullableLatest() throws Exception {
    var doc = data(request("GET", "/v3/api-docs", owner, null), 200);
    long operations = 0;
    var paths = doc.get("paths");
    for (String path : paths.propertyNames())
      if (path.endsWith("/qa") || path.contains("/qa/assessments"))
        operations += paths.get(path).propertyNames().size();
    assertThat(operations).isEqualTo(4);
    var schema = doc.get("components").get("schemas");
    assertThat(schema.get("PatternQaCreateInput").get("additionalProperties").asBoolean())
        .isFalse();
    var union = schema.get("PatternQaView").get("properties").get("latestAssessment").get("oneOf");
    assertThat(union.size()).isEqualTo(2);
    assertThat(union.get(0).get("$ref").asString()).endsWith("/PatternQaAssessmentView");
    assertThat(union.get(1).get("type").asString()).isEqualTo("null");
  }

  @Test
  void exactRevisionIndependentHistoryAndParentVersions() throws Exception {
    UUID r = family.latestRevision().id();
    String path = qaPath(r);
    var empty = data(request("GET", path, owner, null), 200);
    assertThat(empty.get("state").asString()).isEqualTo("UNREVIEWED");
    assertThat(empty.get("latestAssessment").isNull()).isTrue();
    var one = assess(0);
    assertThat(one.assessmentNumber()).isEqualTo(1);
    assertThat(one.notes()).isEqualTo("Human observation 🧵");
    actor(owner);
    qa.create(
        org,
        project.id(),
        style.id(),
        family.id(),
        r,
        new Input(1L, Outcome.CHANGES_REQUESTED, Basis.METADATA_ONLY, null, "Change requested"),
        "qa-test");
    var current = qa.read(org, project.id(), style.id(), family.id(), r);
    assertThat(current.state()).isEqualTo(State.CHANGES_REQUESTED);
    assertThat(current.latestAssessment().assessmentNumber()).isEqualTo(2);
    assertThat(qa.exact(org, project.id(), style.id(), family.id(), r, one.id())).isEqualTo(one);
    var next =
        patterns.createRevision(
            org, project.id(), style.id(), family.id(), next(1), "qa-new-revision");
    assertThat(qa.read(org, project.id(), style.id(), family.id(), next.id()).state())
        .isEqualTo(State.UNREVIEWED);
    assess(2); // Explicitly assess the old revision; it remains independently reviewable.
    assertThat(
            qa.read(org, project.id(), style.id(), family.id(), r)
                .latestAssessment()
                .assessmentNumber())
        .isEqualTo(3);
    assertThat(qa.read(org, project.id(), style.id(), family.id(), next.id()).latestAssessment())
        .isNull();
    assertThat(patterns.read(org, project.id(), style.id(), family.id()).version())
        .isEqualTo(family.version());
    assertThat(patterns.read(org, project.id(), style.id(), family.id()).updatedAt())
        .isEqualTo(family.updatedAt());
    assertThat(projects.read(org, project.id()).version()).isEqualTo(project.version());
    assertThat(styles.read(org, project.id(), style.id()).version()).isEqualTo(style.version());
    assertThat(patterns.readRevision(org, project.id(), style.id(), family.id(), r))
        .isEqualTo(family.latestRevision());
    var publicRow = data(request("GET", path + "/assessments/" + one.id(), owner, null), 200);
    assertThat(publicRow.propertyNames())
        .containsExactlyInAnyOrder(
            "id",
            "patternRevisionId",
            "styleId",
            "assessmentNumber",
            "outcome",
            "evidenceBasis",
            "artifactId",
            "reviewedAt",
            "notes");
    var creator =
        jdbc.sql(
                "SELECT reviewer_issuer||':'||reviewer_subject FROM pattern_qa_assessment WHERE"
                    + " id=:id")
            .param("id", one.id())
            .query(String.class)
            .single();
    assertThat(creator).isEqualTo("urn:source-os:local:" + owner);
    assertThat(qaAudits()).isEqualTo(3);
    for (String state :
        jdbc.sql(
                "SELECT before_state::text||' '||after_state::text FROM audit_event WHERE"
                    + " organization_id=:org AND action='pattern_qa.assessment_recorded'")
            .param("org", org)
            .query(String.class)
            .list())
      assertThat(state)
          .doesNotContain("notes", "Human observation", "reviewerIssuer", "subject", "artifactId");
  }

  @Test
  void readyArtifactAttestationAndReassessmentIsNeverARevisionMutation() {
    var ready = upload();
    actor(owner);
    var a =
        qa.create(
            org,
            project.id(),
            style.id(),
            family.id(),
            ready.revision().id(),
            new Input(
                0L,
                Outcome.HUMAN_REVIEWED,
                Basis.READY_ARTIFACT,
                ready.artifact().id(),
                "Inspected exact retained artifact"),
            "qa-ready");
    assertThat(a.artifactId()).isEqualTo(ready.artifact().id());
    assertThat(a.outcome()).isEqualTo(Outcome.HUMAN_REVIEWED);
    var b =
        qa.create(
            org,
            project.id(),
            style.id(),
            family.id(),
            ready.revision().id(),
            new Input(1L, Outcome.CHANGES_REQUESTED, Basis.METADATA_ONLY, null, "Further changes"),
            "qa-ready");
    assertThat(b.assessmentNumber()).isEqualTo(2);
    assertThat(qa.exact(org, project.id(), style.id(), family.id(), ready.revision().id(), a.id()))
        .isEqualTo(a);
    assertThat(
            patterns.readRevision(
                org, project.id(), style.id(), family.id(), ready.revision().id()))
        .isEqualTo(ready.revision());
  }

  @ParameterizedTest
  @ValueSource(strings = {"OWNER", "ADMIN", "VIEWER", "PLATFORM", "FOREIGN", "NONE", "REVOKED"})
  void allFourOperationsEnforceMembershipRolesAndInternalProvenance(String role) throws Exception {
    var a = assess(0);
    String who =
        switch (role) {
          case "OWNER" -> owner;
          case "ADMIN", "VIEWER" -> {
            String w = "qa-" + id();
            membership(org, w, role.equals("ADMIN") ? "ORG_ADMIN" : "VIEWER", "ACTIVE");
            yield w;
          }
          case "PLATFORM" -> admin();
          case "FOREIGN" -> foreignOwner;
          case "REVOKED" -> {
            String w = "qa-" + id();
            membership(org, w, "ORG_ADMIN", "REVOKED");
            yield w;
          }
          default -> null;
        };
    boolean read = Set.of("OWNER", "ADMIN", "VIEWER").contains(role),
        write = Set.of("OWNER", "ADMIN").contains(role);
    String path = qaPath(family.latestRevision().id());
    for (String endpoint : List.of(path, path + "/assessments", path + "/assessments/" + a.id())) {
      if (read) data(request("GET", endpoint, who, null), 200);
      else problem(request("GET", endpoint, who, null), who == null ? 401 : 403);
    }
    var post = request("POST", path + "/assessments", who, qaBody(1));
    if (write) {
      var row = data(post, 201);
      assertThat(
              jdbc.sql("SELECT reviewer_subject FROM pattern_qa_assessment WHERE id=:id")
                  .param("id", UUID.fromString(row.get("id").asString()))
                  .query(String.class)
                  .single())
          .isEqualTo(who);
    } else problem(post, who == null ? 401 : 403);
    assertThat(qaAudits()).isEqualTo(write ? 2 : 1);
  }

  @ParameterizedTest
  @ValueSource(strings = {"project", "style", "pattern", "revision", "assessment"})
  void wrongAuthorizedHierarchyIsScoped404(String part) throws Exception {
    var a = assess(0);
    String path = qaPath(family.latestRevision().id()) + "/assessments/" + a.id();
    String target =
        switch (part) {
          case "project" -> project.id().toString();
          case "style" -> style.id().toString();
          case "pattern" -> family.id().toString();
          case "revision" -> family.latestRevision().id().toString();
          default -> a.id().toString();
        };
    problem(request("GET", path.replace(target, id().toString()), owner, null), 404);
    assertThat(qaAudits()).isEqualTo(1);
  }

  @ParameterizedTest
  @ValueSource(strings = {"project", "style", "pattern"})
  void archivedParentsPermitAllReadsAndRejectWrites(String parent) throws Exception {
    var a = assess(0);
    archive(parent);
    String path = qaPath(family.latestRevision().id());
    for (String endpoint : List.of(path, path + "/assessments", path + "/assessments/" + a.id()))
      data(request("GET", endpoint, owner, null), 200);
    problem(request("POST", path + "/assessments", owner, qaBody(1)), 409);
    assertThat(qaAudits()).isEqualTo(1);
  }

  @Test
  void membershipRevocationAndStaleHeadDoNotAudit() throws Exception {
    assess(0);
    String path = qaPath(family.latestRevision().id());
    problem(request("POST", path + "/assessments", owner, qaBody(0)), 409);
    revoke();
    problem(request("GET", path, owner, null), 403);
    problem(request("POST", path + "/assessments", owner, qaBody(1)), 403);
    assertThat(qaAudits()).isEqualTo(1);
  }

  @Test
  void historyContinuationIsFirstUnreturnedAndAnchoredAcrossAppend() {
    UUID r = family.latestRevision().id();
    for (int n = 0; n < 28; n++) assess(n);
    var first = qa.history(org, project.id(), style.id(), family.id(), r, 25, 28L);
    assertThat(first.items()).hasSize(25);
    assertThat(first.items().getLast().assessmentNumber()).isEqualTo(4);
    assertThat(first.nextMaxAssessmentNumber()).isEqualTo(3L);
    assess(28);
    var rest =
        qa.history(
            org, project.id(), style.id(), family.id(), r, 25, first.nextMaxAssessmentNumber());
    assertThat(rest.items()).extracting(Summary::assessmentNumber).containsExactly(3L, 2L, 1L);
    assertThat(rest.nextMaxAssessmentNumber()).isNull();
    assertThat(qa.history(org, project.id(), style.id(), family.id(), r, 25, 0L).items()).isEmpty();
  }

  @Test
  void lateAuditFailureRollsBackAssessmentAndAudit() {
    transaction()
        .executeWithoutResult(
            t ->
                doThrow(new IllegalStateException("synthetic late QA audit failure"))
                    .when(recorder)
                    .organizationChanged(
                        eq(org),
                        eq("pattern_qa.assessment_recorded"),
                        anyString(),
                        any(),
                        anyString(),
                        anyMap(),
                        anyMap()));
    assertThatThrownBy(() -> assess(0)).isInstanceOf(IllegalStateException.class);
    assertThat(
            jdbc.sql("SELECT count(*) FROM pattern_qa_assessment WHERE style_id=:style")
                .param("style", style.id())
                .query(Long.class)
                .single())
        .isZero();
    assertThat(qaAudits()).isZero();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "unknown",
        "duplicate",
        "trailing",
        "missing",
        "null-notes",
        "number-notes",
        "identity",
        "time",
        "number",
        "state",
        "outcome",
        "basis",
        "human-metadata",
        "metadata-artifact",
        "ready-missing",
        "empty",
        "nul",
        "surrogate",
        "long",
        "head-string",
        "head-float",
        "head-exponent",
        "head-negative",
        "head-overflow",
        "head-bool"
      })
  void strictHttpShapeAndText(String kind) throws Exception {
    var body = qaBody(0);
    switch (kind) {
      case "unknown" -> body.put("other", true);
      case "missing" -> body.remove("artifactId");
      case "null-notes" -> body.put("notes", null);
      case "number-notes" -> body.put("notes", 42);
      case "identity" -> body.put("reviewerSubject", "forged");
      case "time" -> body.put("reviewedAt", "2026-10-27T00:00:00Z");
      case "number" -> body.put("assessmentNumber", 1);
      case "state" -> body.put("state", "HUMAN_REVIEWED");
      case "outcome" -> body.put("outcome", "PRODUCTION_VERIFIED");
      case "basis" -> body.put("evidenceBasis", 0);
      case "human-metadata" -> body.put("outcome", "HUMAN_REVIEWED");
      case "metadata-artifact" -> body.put("artifactId", id());
      case "ready-missing" -> body.put("evidenceBasis", "READY_ARTIFACT");
      case "empty" -> body.put("notes", " \u0085\ufeff ");
      case "nul" -> body.put("notes", "bad\u0000");
      case "surrogate" -> body.put("notes", "\ud800");
      case "long" -> body.put("notes", "🧵".repeat(2001));
      case "head-string" -> body.put("expectedLatestAssessmentNumber", "0");
      case "head-float" -> body.put("expectedLatestAssessmentNumber", 0.0);
      case "head-negative" -> body.put("expectedLatestAssessmentNumber", -1);
      case "head-overflow" -> body.put("expectedLatestAssessmentNumber", 9007199254740992L);
      case "head-bool" -> body.put("expectedLatestAssessmentNumber", false);
    }
    String raw = json.writeValueAsString(body);
    if (kind.equals("surrogate"))
      raw =
          raw.replace(
              "\"notes\":" + json.writeValueAsString(body.get("notes")), "\"notes\":\"\\ud800\"");
    if (kind.equals("duplicate"))
      raw = raw.replace("\"outcome\":", "\"outcome\":\"OBSERVED\",\"outcome\":");
    if (kind.equals("trailing")) raw += " {}";
    if (kind.equals("head-exponent"))
      raw =
          raw.replace(
              "\"expectedLatestAssessmentNumber\":0", "\"expectedLatestAssessmentNumber\":0e0");
    problem(
        mvc.perform(
            MockMvcRequestBuilders.post(qaPath(family.latestRevision().id()) + "/assessments")
                .header("X-Dev-Subject", owner)
                .header("X-Request-ID", "workspace-reference")
                .contentType("application/json")
                .content(raw)),
        400);
    assertThat(qaAudits()).isZero();
  }
}
