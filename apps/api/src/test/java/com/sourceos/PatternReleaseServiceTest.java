package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.patternrelease.*;
import com.sourceos.patternrelease.ReleaseModels.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class PatternReleaseServiceTest extends PatternArtifactSupport {
  @Autowired PatternReleaseService releases;
  @Autowired ReleaseConsentService consents;

  ConsentView consent() {
    actor(foreignOwner);
    return consents.issue(foreignOrg, new ConsentCreateInput(org), "release-consent");
  }

  CreateInput input(UUID consent) {
    return new CreateInput(consent, 1L, " \u00a0Share exact revision 🧵\u00a0 ", 3600);
  }

  SourceView create(UUID revision, UUID consent) {
    actor(owner);
    return releases.create(
        org, project.id(), style.id(), family.id(), revision, input(consent), "release-create");
  }

  String path(UUID revision) {
    return base() + "/" + family.id() + "/revisions/" + revision + "/releases";
  }

  long releaseRows(String table) {
    return jdbc.sql("SELECT count(*) FROM " + table + " WHERE source_organization_id=:org")
        .param("org", org)
        .query(Long.class)
        .single();
  }

  @Test
  void exactHistoricalRevisionImmutableBindingAndTruthfulFiveEffectCreation() throws Exception {
    var ready = upload();
    var c = consent();
    var created = create(ready.revision().id(), c.id());
    var s = created.release();
    assertThat(s.patternRevisionId()).isEqualTo(ready.revision().id());
    assertThat(s.artifactId()).isEqualTo(ready.artifact().id());
    assertThat(s.purpose()).isEqualTo("Share exact revision 🧵");
    assertThat(created.latestEventNumber()).isEqualTo(1);
    assertThat(created.lifecycle()).isEqualTo(EventKind.ACTIVATED);
    assertThat(java.time.Duration.between(s.releasedAt(), s.expiresAt()))
        .isEqualTo(java.time.Duration.ofHours(1));
    actor(foreignOwner);
    var consumed = consents.read(foreignOrg, c.id());
    assertThat(consumed.state()).isEqualTo(ConsentState.CONSUMED);
    assertThat(consumed.latestEventNumber()).isEqualTo(2);
    assertThat(consumed.consumedReleaseId()).isEqualTo(s.id());
    assertThat(
            jdbc.sql(
                    "SELECT issuer,subject,actor_organization_id FROM pattern_release_consent_event"
                        + " WHERE consent_id=:id AND kind='CONSUMED'")
                .param("id", c.id())
                .query(
                    (r, n) -> List.of(r.getString(1), r.getString(2), r.getObject(3, UUID.class)))
                .single())
        .containsExactly("urn:source-os:local", owner, org);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM audit_event WHERE entity_id=:id AND"
                        + " action='pattern_release.created' AND organization_id=:org AND"
                        + " actor_subject=:subject")
                .param("id", s.id())
                .param("org", org)
                .param("subject", owner)
                .query(Long.class)
                .single())
        .isEqualTo(1);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM audit_event WHERE entity_id=:id AND organization_id=:org")
                .param("id", s.id())
                .param("org", foreignOrg)
                .query(Long.class)
                .single())
        .isZero();
    actor(owner);
    patterns.createRevision(
        org,
        project.id(),
        style.id(),
        family.id(),
        new com.sourceos.pattern.PatternService.RevisionInput(
            2L, "New unrelated revision", null, null),
        "newer");
    assertThat(
            releases
                .read(org, project.id(), style.id(), family.id(), ready.revision().id(), s.id())
                .release())
        .isEqualTo(s);
    assertThat(
            releases
                .list(
                    org,
                    project.id(),
                    style.id(),
                    family.id(),
                    family.latestRevision().id(),
                    25,
                    null)
                .items())
        .isEmpty();
    var dto = data(request("GET", path(ready.revision().id()) + "/" + s.id(), owner, null), 200);
    assertThat(dto.toString())
        .doesNotContain(
            "sha256", "storageObjectId", "issuer", "subject", "sourceVersion", "patternVersion");
    assertThat(
            jdbc.sql("SELECT count(*) FROM pattern_qa_assessment WHERE pattern_revision_id=:id")
                .param("id", ready.revision().id())
                .query(Long.class)
                .single())
        .isZero();
  }

  @Test
  void consumedWrongSourceUnknownAndWithdrawnConsentCannotCreate() {
    var ready = upload();
    var c = consent();
    create(ready.revision().id(), c.id());
    assertThatThrownBy(() -> create(ready.revision().id(), c.id()))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    assertThat(releaseRows("pattern_release")).isEqualTo(1);
    assertThatThrownBy(() -> create(ready.revision().id(), id()))
        .isInstanceOfSatisfying(
            org.springframework.web.server.ResponseStatusException.class,
            e -> assertThat(e.getStatusCode().value()).isEqualTo(404));
    actor(foreignOwner);
    var wrong = consents.issue(foreignOrg, new ConsentCreateInput(id()), "wrong-source");
    assertThatThrownBy(() -> create(ready.revision().id(), wrong.id()))
        .isInstanceOfSatisfying(
            org.springframework.web.server.ResponseStatusException.class,
            e -> assertThat(e.getStatusCode().value()).isEqualTo(404));
    var another = consent();
    actor(foreignOwner);
    consents.withdraw(foreignOrg, another.id(), new EventCommand(1L), "withdraw-first");
    assertThatThrownBy(() -> create(ready.revision().id(), another.id()))
        .isInstanceOfSatisfying(
            org.springframework.web.server.ResponseStatusException.class,
            e -> assertThat(e.getStatusCode().value()).isEqualTo(409));
  }

  @Test
  void roleAndExactHierarchyHttpScopesAndArchivedWrites() throws Exception {
    var ready = upload();
    var c = consent();
    String viewer = "release-source-viewer-" + id();
    membership(org, viewer, "VIEWER", "ACTIVE");
    Map<String, Object> body =
        new LinkedHashMap<>(
            Map.of(
                "consentId",
                c.id(),
                "expectedLatestConsentEventNumber",
                1,
                "purpose",
                "Inspect exact bytes"));
    problem(request("POST", path(ready.revision().id()), viewer, body), 403);
    problem(request("POST", path(ready.revision().id()), foreignOwner, body), 403);
    problem(
        request(
            "POST",
            path(ready.revision().id()),
            owner,
            new LinkedHashMap<>(
                Map.of(
                    "consentId",
                    c.id(),
                    "expectedLatestConsentEventNumber",
                    0,
                    "purpose",
                    "Inspect"))),
        409);
    var created = data(request("POST", path(ready.revision().id()), owner, body), 201);
    UUID release = UUID.fromString(created.get("release").get("id").asString());
    assertThat(
            java.time.Duration.between(
                java.time.Instant.parse(created.get("release").get("releasedAt").asString()),
                java.time.Instant.parse(created.get("release").get("expiresAt").asString())))
        .isEqualTo(java.time.Duration.ofHours(24));
    data(request("GET", path(ready.revision().id()) + "/" + release, viewer, null), 200);
    problem(
        request(
            "POST",
            path(ready.revision().id()) + "/" + release + "/revocations",
            viewer,
            Map.of("expectedLatestEventNumber", 1)),
        403);
    problem(request("GET", path(family.latestRevision().id()) + "/" + release, owner, null), 404);
    problem(
        request(
            "GET",
            path(ready.revision().id())
                .replace(project.id().toString(), foreignProject.id().toString()),
            owner,
            null),
        404);
    actor(owner);
    projects.update(
        org,
        project.id(),
        new com.sourceos.project.ProjectService.UpdateInput(
            project.name(),
            project.description(),
            com.sourceos.project.ProjectService.Status.ARCHIVED,
            0L),
        "archive-source");
    data(request("GET", path(ready.revision().id()) + "/" + release, owner, null), 200);
    problem(
        request(
            "POST",
            path(ready.revision().id()) + "/" + release + "/revocations",
            owner,
            Map.of("expectedLatestEventNumber", 1)),
        409);
    var next = consent();
    body.put("consentId", next.id());
    problem(request("POST", path(ready.revision().id()), owner, body), 409);
  }

  @Test
  void irreversibleRevokeNoOpStaleAndAnchoredEventContinuation() {
    var ready = upload();
    var c = consent();
    var release = create(ready.revision().id(), c.id());
    var s = release.release();
    var anchor =
        releases.events(
            org, project.id(), style.id(), family.id(), s.patternRevisionId(), s.id(), 1, 1L);
    assertThat(anchor.items()).hasSize(1);
    var revoked =
        releases.revoke(
            org,
            project.id(),
            style.id(),
            family.id(),
            s.patternRevisionId(),
            s.id(),
            new EventCommand(1L),
            "revoke");
    assertThat(revoked.latestEventNumber()).isEqualTo(2);
    assertThat(revoked.lifecycle()).isEqualTo(EventKind.REVOKED);
    assertThatThrownBy(
            () ->
                releases.revoke(
                    org,
                    project.id(),
                    style.id(),
                    family.id(),
                    s.patternRevisionId(),
                    s.id(),
                    new EventCommand(1L),
                    "stale"))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    assertThat(
            releases.revoke(
                org,
                project.id(),
                style.id(),
                family.id(),
                s.patternRevisionId(),
                s.id(),
                new EventCommand(2L),
                "current-noop"))
        .isEqualTo(revoked);
    var page =
        releases.events(
            org, project.id(), style.id(), family.id(), s.patternRevisionId(), s.id(), 1, 2L);
    assertThat(page.items().getFirst().eventNumber()).isEqualTo(2);
    assertThat(page.nextMaxEventNumber()).isEqualTo(1);
    var older =
        releases.events(
            org,
            project.id(),
            style.id(),
            family.id(),
            s.patternRevisionId(),
            s.id(),
            1,
            page.nextMaxEventNumber());
    assertThat(older.items()).isEqualTo(anchor.items());
    assertThat(older.nextMaxEventNumber()).isNull();
    assertThat(auditCount(s.id())).isEqualTo(2);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "{}",
        "[]",
        "{\"consentId\":null,\"expectedLatestConsentEventNumber\":1,\"purpose\":\"p\"}",
        "{\"consentId\":\"wrong\",\"expectedLatestConsentEventNumber\":1,\"purpose\":\"p\"}",
        "{\"consentId\":\"00000000-0000-4000-8000-000000000001\",\"expectedLatestConsentEventNumber\":1e0,\"purpose\":\"p\"}",
        "{\"consentId\":\"00000000-0000-4000-8000-000000000001\",\"expectedLatestConsentEventNumber\":1,\"purpose\":true}",
        "{\"consentId\":\"00000000-0000-4000-8000-000000000001\",\"expectedLatestConsentEventNumber\":1,\"purpose\":\"p\",\"artifactId\":null}",
        "{\"consentId\":\"00000000-0000-4000-8000-000000000001\",\"expectedLatestConsentEventNumber\":1,\"purpose\":\"p\",\"accessDurationSeconds\":null}",
        "{\"consentId\":\"00000000-0000-4000-8000-000000000001\",\"expectedLatestConsentEventNumber\":1,\"purpose\":\"p\",\"accessDurationSeconds\":0}",
        "{\"consentId\":\"00000000-0000-4000-8000-000000000001\",\"expectedLatestConsentEventNumber\":1,\"purpose\":\"p\",\"accessDurationSeconds\":86401}"
      })
  void strictCreationInput(String body) throws Exception {
    problem(
        mvc.perform(
            MockMvcRequestBuilders.post(path(family.latestRevision().id()))
                .header("X-Dev-Subject", owner)
                .header("X-Request-ID", "workspace-reference")
                .contentType("application/json")
                .content(body)),
        400);
    assertThat(releaseRows("pattern_release")).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"release", "activation", "consumption", "audit", "commit"})
  void actualDatabaseFaultAfterEachConstructionStageRollsEverythingBack(String point) {
    var ready = upload();
    var c = consent();
    actor(owner);
    String suffix = id().toString().replace("-", "");
    String trigger = "release_fault_" + suffix, fn = "release_fault_fn_" + suffix;
    String table =
        switch (point) {
          case "release", "commit" -> "pattern_release";
          case "activation" -> "pattern_release_event";
          case "consumption" -> "pattern_release_consent_event";
          default -> "audit_event";
        };
    String predicate =
        point.equals("consumption")
            ? "NEW.actor_organization_id='" + org + "' AND NEW.kind='CONSUMED'"
            : point.equals("audit")
                ? "NEW.organization_id='" + org + "' AND NEW.action='pattern_release.created'"
                : "NEW.source_organization_id='" + org + "'";
    jdbc.sql(
            "CREATE FUNCTION "
                + fn
                + "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF "
                + predicate
                + " THEN RAISE EXCEPTION 'synthetic release fault'; END IF; RETURN NEW; END $$")
        .update();
    jdbc.sql(
            point.equals("commit")
                ? "CREATE CONSTRAINT TRIGGER "
                    + trigger
                    + " AFTER INSERT ON "
                    + table
                    + " DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "
                    + fn
                    + "()"
                : "CREATE TRIGGER "
                    + trigger
                    + " BEFORE INSERT ON "
                    + table
                    + " FOR EACH ROW EXECUTE FUNCTION "
                    + fn
                    + "()")
        .update();
    try {
      assertThatThrownBy(() -> create(ready.revision().id(), c.id()))
          .isInstanceOf(RuntimeException.class);
      assertThat(releaseRows("pattern_release")).isZero();
      assertThat(releaseRows("pattern_release_event")).isZero();
      assertThat(
              jdbc.sql(
                      "SELECT count(*) FROM pattern_release_consent_event WHERE consent_id=:id AND"
                          + " kind='CONSUMED'")
                  .param("id", c.id())
                  .query(Long.class)
                  .single())
          .isZero();
      assertThat(
              jdbc.sql(
                      "SELECT count(*) FROM audit_event WHERE organization_id=:org AND"
                          + " action='pattern_release.created'")
                  .param("org", org)
                  .query(Long.class)
                  .single())
          .isZero();
      actor(foreignOwner);
      assertThat(consents.read(foreignOrg, c.id()).state()).isEqualTo(ConsentState.ISSUED);
    } finally {
      jdbc.sql("DROP TRIGGER " + trigger + " ON " + table).update();
      jdbc.sql("DROP FUNCTION " + fn + "()").update();
    }
  }
}
