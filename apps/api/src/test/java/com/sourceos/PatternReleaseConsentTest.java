package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.sourceos.organization.OrganizationService;
import com.sourceos.patternrelease.*;
import com.sourceos.patternrelease.ReleaseModels.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class PatternReleaseConsentTest extends WorkspaceIntegrationSupport {
  @Autowired ReleaseConsentService consents;
  @Autowired OrganizationService organizations;
  @MockitoSpyBean com.sourceos.audit.AuditRecorder recorder;

  String path() {
    return "/api/v1/organizations/" + foreignOrg + "/release-consents";
  }

  ConsentView issue() {
    actor(foreignOwner);
    return consents.issue(foreignOrg, new ConsentCreateInput(org), "consent-test");
  }

  long rows(String table) {
    return jdbc.sql("SELECT count(*) FROM " + table + " WHERE recipient_organization_id=:org")
        .param("org", foreignOrg)
        .query(Long.class)
        .single();
  }

  @Test
  void recipientIssuedOpaqueSourceAndImmutableTimeAndAudit() throws Exception {
    var known =
        data(request("POST", path(), foreignOwner, Map.of("sourceOrganizationId", org)), 201);
    var unknown =
        data(request("POST", path(), foreignOwner, Map.of("sourceOrganizationId", id())), 201);
    assertThat(known.propertyNames()).isEqualTo(unknown.propertyNames());
    assertThat(known.get("state").asString()).isEqualTo("ISSUED");
    assertThat(known.get("latestEventNumber").asLong()).isEqualTo(1);
    var expires = java.time.Instant.parse(known.get("expiresAt").asString());
    var issued = java.time.Instant.parse(known.get("issuedAt").asString());
    assertThat(java.time.Duration.between(issued, expires))
        .isEqualTo(java.time.Duration.ofMinutes(15));
    assertThat(rows("pattern_release_consent")).isEqualTo(2);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM audit_event WHERE organization_id=:org AND"
                        + " action='pattern_release_consent.issued'")
                .param("org", foreignOrg)
                .query(Long.class)
                .single())
        .isEqualTo(2);
    assertThat(known.toString())
        .doesNotContain("issuer", "subject", "storage", "sha256", "Foreign private");
  }

  @Test
  void withdrawalIsIrreversibleStaleIs409AndRepeatedCurrentHeadIsNoOp() throws Exception {
    var v = issue();
    String exact = path() + "/" + v.id();
    var changed =
        data(
            request(
                "POST",
                exact + "/withdrawals",
                foreignOwner,
                Map.of("expectedLatestEventNumber", 1)),
            200);
    assertThat(changed.get("state").asString()).isEqualTo("WITHDRAWN");
    assertThat(changed.get("latestEventNumber").asLong()).isEqualTo(2);
    problem(
        request(
            "POST", exact + "/withdrawals", foreignOwner, Map.of("expectedLatestEventNumber", 1)),
        409);
    var again =
        data(
            request(
                "POST",
                exact + "/withdrawals",
                foreignOwner,
                Map.of("expectedLatestEventNumber", 2)),
            200);
    assertThat(again).isEqualTo(changed);
    assertThat(rows("pattern_release_consent_event")).isEqualTo(2);
    assertThat(auditCount(v.id())).isEqualTo(2);
  }

  @Test
  void requestedOrganizationRolesAndForeignIdsAreScoped() throws Exception {
    var v = issue();
    String viewer = "release-viewer-" + id();
    membership(foreignOrg, viewer, "VIEWER", "ACTIVE");
    problem(request("GET", path(), viewer, null), 403);
    problem(request("GET", path() + "/" + v.id(), viewer, null), 403);
    problem(request("POST", path(), viewer, Map.of("sourceOrganizationId", org)), 403);
    problem(
        request(
            "POST",
            path() + "/" + v.id() + "/withdrawals",
            viewer,
            Map.of("expectedLatestEventNumber", 1)),
        403);
    problem(request("GET", path(), owner, null), 403);
    problem(request("GET", path(), "platform-admin", null), 403);
    problem(request("GET", path() + "/" + id(), foreignOwner, null), 404);
    String other = "/api/v1/organizations/" + org + "/release-consents/" + v.id();
    problem(request("GET", other, owner, null), 404);
    var unauth =
        mvc.perform(
            MockMvcRequestBuilders.get(path()).header("X-Request-ID", "workspace-reference"));
    problem(unauth, 401);
    String admin = "release-admin-" + id();
    membership(foreignOrg, admin, "ORG_ADMIN", "ACTIVE");
    data(request("POST", path(), admin, Map.of("sourceOrganizationId", org)), 201);
    jdbc.sql(
            "UPDATE membership SET status='REVOKED' WHERE organization_id=:org AND"
                + " subject=:subject")
        .param("org", foreignOrg)
        .param("subject", admin)
        .update();
    problem(request("GET", path(), admin, null), 403);
    problem(request("POST", path(), foreignOwner, Map.of("sourceOrganizationId", foreignOrg)), 400);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "{}",
        "[]",
        "null",
        "{\"sourceOrganizationId\":null}",
        "{\"sourceOrganizationId\":true}",
        "{\"sourceOrganizationId\":123}",
        "{\"sourceOrganizationId\":\"wrong\"}",
        "{\"sourceOrganizationId\":\"00000000-0000-4000-8000-000000000001\",\"issuer\":\"fake\"}",
        "{\"sourceOrganizationId\":\"00000000-0000-4000-8000-000000000001\",\"sourceOrganizationId\":\"00000000-0000-4000-8000-000000000002\"}",
        "{\"sourceOrganizationId\":\"00000000-0000-4000-8000-000000000001\"} {}"
      })
  void strictConsentJson(String body) throws Exception {
    problem(
        mvc.perform(
            MockMvcRequestBuilders.post(path())
                .header("X-Dev-Subject", foreignOwner)
                .header("X-Request-ID", "workspace-reference")
                .contentType("application/json")
                .content(body)),
        400);
    assertThat(rows("pattern_release_consent")).isZero();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "null",
        "\"1\"",
        "1.0",
        "1e0",
        "true",
        "-1",
        "9007199254740992",
        "9223372036854775808"
      })
  void exactSafeIntegerHeadRequired(String number) throws Exception {
    var v = issue();
    problem(
        mvc.perform(
            MockMvcRequestBuilders.post(path() + "/" + v.id() + "/withdrawals")
                .header("X-Dev-Subject", foreignOwner)
                .header("X-Request-ID", "workspace-reference")
                .contentType("application/json")
                .content("{\"expectedLatestEventNumber\":" + number + "}")),
        400);
    assertThat(auditCount(v.id())).isEqualTo(1);
    assertThat(rows("pattern_release_consent_event")).isEqualTo(1);
  }

  @Test
  void boundedKeysetIsContextBoundAndNoDetailFanout() throws Exception {
    var a = issue();
    var b = issue();
    actor(foreignOwner);
    var first = consents.list(foreignOrg, 1, null);
    assertThat(first.items()).extracting(ConsentView::id).containsExactly(b.id());
    assertThat(first.nextCursor()).isNotBlank();
    var second = consents.list(foreignOrg, 1, first.nextCursor());
    assertThat(second.items()).extracting(ConsentView::id).containsExactly(a.id());
    assertThat(second.nextCursor()).isNull();
    actor(owner);
    assertThatThrownBy(() -> consents.list(org, 1, first.nextCursor()))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    problem(request("GET", path() + "?limit=0", foreignOwner, null), 400);
    problem(request("GET", path() + "?limit=101", foreignOwner, null), 400);
  }

  @Test
  void lateAuditFailureRollsBackConsentAndEventAndActualAudit() {
    actor(foreignOwner);
    transaction()
        .executeWithoutResult(
            t ->
                doAnswer(
                        a -> {
                          a.callRealMethod();
                          throw new IllegalStateException("synthetic late audit failure");
                        })
                    .when(recorder)
                    .organizationChanged(
                        eq(foreignOrg),
                        eq("pattern_release_consent.issued"),
                        any(),
                        any(),
                        any(),
                        any(),
                        any()));
    assertThatThrownBy(() -> consents.issue(foreignOrg, new ConsentCreateInput(org), "late-audit"))
        .isInstanceOf(IllegalStateException.class);
    assertThat(rows("pattern_release_consent")).isZero();
    assertThat(rows("pattern_release_consent_event")).isZero();
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM audit_event WHERE organization_id=:org AND"
                        + " action='pattern_release_consent.issued'")
                .param("org", foreignOrg)
                .query(Long.class)
                .single())
        .isZero();
  }

  @Test
  void actualJpaRenameNoOpStaleAndJdbcLifecyclesRemainCompatible() {
    actor(owner);
    var original = organizations.read(org);
    var renamed = organizations.rename(org, "Renamed source", original.version(), "option-b");
    assertThat(renamed.version()).isEqualTo(original.version() + 1);
    var same = organizations.rename(org, "Renamed source", renamed.version(), "option-b-noop");
    assertThat(same.version()).isEqualTo(renamed.version());
    assertThatThrownBy(
            () -> organizations.rename(org, "Stale", original.version(), "option-b-stale"))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    var p =
        projects.update(
            org,
            project.id(),
            new com.sourceos.project.ProjectService.UpdateInput(
                project.name(),
                project.description(),
                com.sourceos.project.ProjectService.Status.ARCHIVED,
                project.version()),
            "archive");
    p =
        projects.update(
            org,
            project.id(),
            new com.sourceos.project.ProjectService.UpdateInput(
                p.name(),
                p.description(),
                com.sourceos.project.ProjectService.Status.ACTIVE,
                p.version()),
            "reactivate");
    assertThat(p.version()).isEqualTo(2);
    var st =
        styles.update(
            org,
            project.id(),
            style.id(),
            new com.sourceos.style.StyleService.UpdateInput(
                style.styleCode(),
                style.name(),
                style.description(),
                com.sourceos.style.StyleService.Status.ARCHIVED,
                style.version()),
            "archive");
    st =
        styles.update(
            org,
            project.id(),
            style.id(),
            new com.sourceos.style.StyleService.UpdateInput(
                st.styleCode(),
                st.name(),
                st.description(),
                com.sourceos.style.StyleService.Status.ACTIVE,
                st.version()),
            "reactivate");
    assertThat(st.version()).isEqualTo(2);
  }
}
