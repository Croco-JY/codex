package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.sourceos.patternrelease.ReleaseModels.*;
import java.net.URI;
import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
// This distinct spy graph owns its pool; do not retain it in the cumulative context cache.
@org.springframework.test.annotation.DirtiesContext(
    classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
class PatternReleaseHttpTest extends PatternReleaseIntegrationSupport {
  @Value("${local.server.port}")
  int port;

  @MockitoSpyBean JdbcClient observedJdbc;

  String consentPath() {
    return "/api/v1/organizations/" + foreignOrg + "/release-consents";
  }

  String sourcePath() {
    return "/api/v1/organizations/"
        + org
        + "/projects/"
        + project.id()
        + "/styles/"
        + style.id()
        + "/patterns/"
        + family.id()
        + "/revisions/"
        + ready.revision().id()
        + "/releases";
  }

  HttpResponse<byte[]> http(String method, String path, String actor, Object body, int expected)
      throws Exception {
    var request =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
            .header("X-Request-ID", "phase-3f-http");
    if (actor != null) request.header("X-Dev-Subject", actor);
    if (body == null) request.method(method, HttpRequest.BodyPublishers.noBody());
    else
      request
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body)));
    try (var client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()) {
      var response = client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
      assertThat(response.statusCode())
          .as(
              method
                  + " "
                  + path
                  + ": "
                  + new String(response.body(), java.nio.charset.StandardCharsets.UTF_8))
          .isEqualTo(expected);
      assertThat(response.headers().firstValue("X-Request-ID")).contains("phase-3f-http");
      if (expected < 400)
        assertThat(response.headers().firstValue("Cache-Control")).contains("private, no-store");
      if (expected >= 400) {
        assertThat(response.headers().firstValue("Content-Type").orElse(""))
            .startsWith("application/problem+json");
        var problem = json.readTree(response.body());
        assertThat(problem.get("requestId").asString()).isEqualTo("phase-3f-http");
        assertThat(problem.get("status").asInt()).isEqualTo(expected);
        assertThat(new String(response.body(), java.nio.charset.StandardCharsets.UTF_8))
            .doesNotContain(
                "%PDF", "storage_object_id", "/tmp/", "SQLException", "urn:source-os:local");
      }
      return response;
    }
  }

  @Test
  void twelveActualHttpOperationsAndBinaryHeaders() throws Exception {
    var issued =
        json.readTree(
            http("POST", consentPath(), foreignOwner, Map.of("sourceOrganizationId", org), 201)
                .body());
    String consent = issued.get("id").asString();
    http("GET", consentPath() + "?limit=1", foreignOwner, null, 200);
    http("GET", consentPath() + "/" + consent, foreignOwner, null, 200);
    var created =
        json.readTree(
            http(
                    "POST",
                    sourcePath(),
                    owner,
                    Map.of(
                        "consentId",
                        consent,
                        "expectedLatestConsentEventNumber",
                        1,
                        "purpose",
                        "Exact HTTP artifact"),
                    201)
                .body());
    String release = created.get("release").get("id").asString();
    assertThat(created.get("effectiveState").asString()).isEqualTo("ACTIVE");
    http("GET", sourcePath() + "?limit=1", owner, null, 200);
    http("GET", sourcePath() + "/" + release, owner, null, 200);
    http("GET", sourcePath() + "/" + release + "/events?maxEventNumber=1", owner, null, 200);
    String inbox = "/api/v1/organizations/" + foreignOrg + "/received-pattern-releases";
    http("GET", inbox + "?limit=1", foreignOwner, null, 200);
    http("GET", inbox + "/" + release, foreignOwner, null, 200);
    var binary = http("GET", inbox + "/" + release + "/content", foreignOwner, null, 200);
    assertThat(binary.body()).containsExactly(pdfBytes());
    assertThat(binary.headers().firstValue("Content-Type")).contains("application/octet-stream");
    assertThat(binary.headers().firstValue("Cache-Control")).contains("private, no-store");
    assertThat(binary.headers().firstValue("X-Content-Type-Options")).contains("nosniff");
    assertThat(binary.headers().firstValue("Content-Disposition").orElse(""))
        .contains("attachment;", "filename*=");
    assertThat(binary.headers().firstValue("Content-Length"))
        .contains(Integer.toString(pdfBytes().length));
    http(
        "POST",
        sourcePath() + "/" + release + "/revocations",
        owner,
        Map.of("expectedLatestEventNumber", 1),
        200);
    http("GET", inbox + "/" + release + "/content", foreignOwner, null, 404);
    var withdrawn =
        json.readTree(
            http(
                    "POST",
                    consentPath() + "/" + consent + "/withdrawals",
                    foreignOwner,
                    Map.of("expectedLatestEventNumber", 2),
                    200)
                .body());
    assertThat(withdrawn.get("state").asString()).isEqualTo("WITHDRAWN");
    PatternReleaseEvidence.write(
        "actual-http-twelve-operations",
        Map.of("operationCount", 12, "binaryExact", true, "revokedDownloadStatus", 404));
  }

  @ParameterizedTest
  @ValueSource(strings = {"ORG_OWNER", "ORG_ADMIN", "VIEWER"})
  void recipientRolesSeeOnlyMinimalScopedProjectionAndValidContent(String role) throws Exception {
    String user = "http-recipient-" + id();
    membership(foreignOrg, user, role, "ACTIVE");
    var body =
        new String(
            http("GET", recipientPath(), user, null, 200).body(),
            java.nio.charset.StandardCharsets.UTF_8);
    assertThat(body)
        .doesNotContain(
            "projectId",
            "styleId",
            "patternId\"",
            "storage",
            "sha256",
            "issuer",
            "subject",
            "version",
            "consentId");
    assertThat(http("GET", recipientPath() + "/content", user, null, 200).body())
        .containsExactly(pdfBytes());
    http("GET", consentPath(), user, null, role.equals("VIEWER") ? 403 : 200);
    http(
        "POST",
        consentPath(),
        user,
        Map.of("sourceOrganizationId", org),
        role.equals("VIEWER") ? 403 : 201);
    if (role.equals("VIEWER"))
      http(
          "POST",
          consentPath() + "/" + receivingConsent.id() + "/withdrawals",
          user,
          Map.of("expectedLatestEventNumber", 2),
          403);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "anonymous",
        "source-only",
        "nonmember",
        "platform-admin",
        "revoked",
        "wrong-issuer",
        "foreign-scope"
      })
  void guessedIdentifiersNeverProvidePrivateRecipientAccess(String kind) throws Exception {
    String user =
        switch (kind) {
          case "anonymous" -> null;
          case "source-only" -> owner;
          case "platform-admin" -> admin();
          default -> "http-denied-" + id();
        };
    if (kind.equals("revoked")) membership(foreignOrg, user, "ORG_OWNER", "REVOKED");
    if (kind.equals("wrong-issuer"))
      jdbc.sql(
              "INSERT INTO membership(id,organization_id,issuer,subject,role,status)"
                  + " VALUES(:id,:org,'https://another-issuer.invalid',:subject,'ORG_OWNER','ACTIVE')")
          .param("id", id())
          .param("org", foreignOrg)
          .param("subject", user)
          .update();
    String path =
        kind.equals("foreign-scope")
            ? recipientPath().replace(foreignOrg.toString(), org.toString())
            : recipientPath();
    if (kind.equals("foreign-scope")) user = owner;
    http(
        "GET",
        path,
        user,
        null,
        kind.equals("anonymous") ? 401 : kind.equals("foreign-scope") ? 404 : 403);
    http(
        "GET",
        path + "/content",
        user,
        null,
        kind.equals("anonymous") ? 401 : kind.equals("foreign-scope") ? 404 : 403);
  }

  @Test
  void invalidationRedactsDetailWhileSourceRetainsImmutableReceipt() throws Exception {
    withdraw();
    var inactive = json.readTree(http("GET", recipientPath(), foreignOwner, null, 200).body());
    var keys = new HashSet<String>();
    inactive.propertyNames().forEach(keys::add);
    assertThat(keys)
        .containsExactlyInAnyOrder(
            "releaseId",
            "sourceOrganizationId",
            "recipientOrganizationId",
            "releasedAt",
            "expiresAt",
            "effectiveState");
    assertThat(inactive.get("effectiveState").asString()).isEqualTo("WITHDRAWN");
    var source =
        json.readTree(http("GET", sourcePath() + "/" + releaseId(), owner, null, 200).body());
    assertThat(source.get("release").get("patternRevisionId").asString())
        .isEqualTo(ready.revision().id().toString());
    assertThat(source.get("effectiveState").asString()).isEqualTo("WITHDRAWN");
  }

  @Test
  void receivedCollectionUsesConstantBulkQueryBudgetAndStrictCursorScope() throws Exception {
    for (int i = 0; i < 4; i++) {
      actor(foreignOwner);
      var consent = consents.issue(foreignOrg, new ConsentCreateInput(org), "inbox-consent");
      actor(owner);
      releases.create(
          org,
          project.id(),
          style.id(),
          family.id(),
          ready.revision().id(),
          new CreateInput(consent.id(), 1L, "Bounded inbox " + i, 86400),
          "inbox-release");
    }
    String inbox = "/api/v1/organizations/" + foreignOrg + "/received-pattern-releases";
    clearInvocations(observedJdbc);
    var page = json.readTree(http("GET", inbox + "?limit=1", foreignOwner, null, 200).body());
    long one = queries();
    clearInvocations(observedJdbc);
    var full = json.readTree(http("GET", inbox + "?limit=100", foreignOwner, null, 200).body());
    long five = queries();
    assertThat(full.get("items").size()).isEqualTo(5);
    assertThat(five).isEqualTo(one).isLessThanOrEqualTo(10);
    String cursor = page.get("nextCursor").asString();
    http("GET", inbox + "?limit=1&cursor=" + cursor, foreignOwner, null, 200);
    http(
        "GET",
        inbox.replace(foreignOrg.toString(), org.toString()) + "?cursor=" + cursor,
        owner,
        null,
        400);
    for (String query : List.of("limit=0", "limit=101", "limit=-1", "limit=1.0", "cursor=broken"))
      http("GET", inbox + "?" + query, foreignOwner, null, 400);
    PatternReleaseEvidence.write(
        "recipient-inbox-bulk-query-budget",
        Map.of("oneRowQueries", one, "fiveRowQueries", five, "rows", 5));
  }

  private long queries() {
    return mockingDetails(observedJdbc).getInvocations().stream()
        .filter(i -> i.getMethod().getName().equals("sql") && i.getArguments()[0] instanceof String)
        .count();
  }
}
