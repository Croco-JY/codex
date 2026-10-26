package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.sourceos.grading.GradingModels;
import com.sourceos.grading.GradingService;
import java.net.URI;
import java.net.http.*;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class GradingHttpTest extends GradingSupport {
  @Value("${local.server.port}")
  int port;

  @MockitoSpyBean JdbcClient observedJdbc;

  List<String> statements() {
    return mockingDetails(observedJdbc).getInvocations().stream()
        .filter(i -> i.getMethod().getName().equals("sql") && i.getArguments()[0] instanceof String)
        .map(i -> (String) i.getArguments()[0])
        .toList();
  }

  @Test
  @SuppressWarnings("unchecked")
  void maximumLegalSnapshotOverActualHttpAndExactReadBack() throws Exception {
    var snapshot = body(30, 100);
    snapshot.put("name", "🧵".repeat(160));
    snapshot.put("notes", "🧵".repeat(1000));
    var sizes = (List<Map<String, Object>>) snapshot.get("sizes");
    for (int i = 0; i < 30; i++) {
      sizes.get(i).put("code", String.format(Locale.ROOT, "S%039d", i));
      sizes.get(i).put("label", "🧵".repeat(80));
    }
    snapshot.put("baseSizeCode", sizes.get(1).get("code"));
    var rules = (List<Map<String, Object>>) snapshot.get("rules");
    for (int i = 0; i < 100; i++) {
      var rule = rules.get(i);
      rule.put("code", String.format(Locale.ROOT, "R%079d", i));
      rule.put("label", "🧵".repeat(160));
      rule.put("notes", "🧵".repeat(1000));
      var values = (List<Map<String, Object>>) rule.get("values");
      for (int j = 0; j < 30; j++) values.get(j).put("sizeCode", sizes.get(j).get("code"));
    }
    long validationStart = System.nanoTime();
    GradingService.validated(json.convertValue(snapshot, GradingModels.CreateInput.class));
    long validation = System.nanoTime() - validationStart;
    byte[] body = json.writeValueAsBytes(snapshot);
    clearInvocations(observedJdbc);
    try (var client = HttpClient.newHttpClient()) {
      long start = System.nanoTime();
      var response =
          client.send(
              HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + base()))
                  .header("X-Dev-Subject", owner)
                  .header("Content-Type", "application/json")
                  .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                  .build(),
              HttpResponse.BodyHandlers.ofByteArray());
      long create = System.nanoTime() - start;
      assertThat(response.statusCode()).isEqualTo(201);
      var first = json.readTree(response.body());
      var createSql = statements();
      assertThat(createSql.stream().filter(s -> s.startsWith("INSERT INTO grade_rule_value")))
          .hasSize(1);
      assertThat(createSql.stream().filter(s -> s.contains("grade_"))).hasSize(10);
      var r = first.get("latestRevision");
      assertThat(r.get("sizes").size()).isEqualTo(30);
      assertThat(r.get("rules").size()).isEqualTo(100);
      for (int i = 0; i < 100; i++) {
        var rule = r.get("rules").get(i);
        assertThat(rule.get("position").asInt()).isEqualTo(i);
        assertThat(rule.get("values").size()).isEqualTo(30);
        for (int j = 0; j < 30; j++) {
          var value = rule.get("values").get(j);
          assertThat(value.get("sizeCode").asString()).isEqualTo(sizes.get(j).get("code"));
          assertThat(value.get("delta").isString()).isTrue();
          assertThat(value.get("delta").asString())
              .isEqualTo(j == 1 ? "0.0000" : "-123456789012345.6789");
        }
      }
      String id = first.get("id").asString(), revision = r.get("id").asString();
      clearInvocations(observedJdbc);
      start = System.nanoTime();
      var detail =
          client.send(
              HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + base() + "/" + id))
                  .header("X-Dev-Subject", owner)
                  .GET()
                  .build(),
              HttpResponse.BodyHandlers.ofByteArray());
      long read = System.nanoTime() - start;
      assertThat(detail.statusCode()).isEqualTo(200);
      var readSql = statements();
      assertThat(readSql.stream().filter(s -> s.contains("grade_"))).hasSize(6);
      assertThat(json.readTree(detail.body())).isEqualTo(first);
      actor(owner);
      var exact =
          grading.readRevision(
              org, project.id(), style.id(), UUID.fromString(id), UUID.fromString(revision));
      assertThat(exact.rules()).hasSize(100);
      assertThat(exact.sizes()).hasSize(30);
      clearInvocations(observedJdbc);
      var collection =
          client.send(
              HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + base()))
                  .header("X-Dev-Subject", owner)
                  .GET()
                  .build(),
              HttpResponse.BodyHandlers.ofByteArray());
      assertThat(collection.statusCode()).isEqualTo(200);
      assertThat(statements().stream().filter(s -> s.contains("grade_"))).hasSize(1);
      assertThat(
              json.readTree(collection.body())
                  .get("items")
                  .get(0)
                  .get("latestRevision")
                  .propertyNames())
          .doesNotContain("rules", "sizes", "notes");
      clearInvocations(observedJdbc);
      var history =
          client.send(
              HttpRequest.newBuilder(
                      URI.create(
                          "http://127.0.0.1:"
                              + port
                              + base()
                              + "/"
                              + id
                              + "/revisions?maxRevisionNumber=1"))
                  .header("X-Dev-Subject", owner)
                  .GET()
                  .build(),
              HttpResponse.BodyHandlers.ofByteArray());
      assertThat(history.statusCode()).isEqualTo(200);
      assertThat(statements().stream().filter(s -> s.contains("grade_"))).hasSize(2);
      assertThat(statements()).noneMatch(s -> s.contains("grade_rule_value"));
      clearInvocations(observedJdbc);
      var noop =
          client.send(
              HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + base() + "/" + id))
                  .header("X-Dev-Subject", owner)
                  .header("Content-Type", "application/json")
                  .PUT(HttpRequest.BodyPublishers.ofString("{\"status\":\"ACTIVE\",\"version\":0}"))
                  .build(),
              HttpResponse.BodyHandlers.ofByteArray());
      assertThat(noop.statusCode()).isEqualTo(200);
      assertThat(statements()).noneMatch(s -> s.startsWith("UPDATE") || s.startsWith("INSERT"));
      assertThat(json.readTree(noop.body()).get("updatedAt")).isEqualTo(first.get("updatedAt"));
      System.out.printf(
          "GRADING_MAX_HTTP requestBytes=%d createResponseBytes=%d detailResponseBytes=%d"
              + " validationMs=%.3f createMs=%.3f detailMs=%.3f createJdbcStatements=%d"
              + " detailJdbcStatements=%d valueInsertStatements=1%n",
          body.length,
          response.body().length,
          detail.body().length,
          validation / 1e6,
          create / 1e6,
          read / 1e6,
          createSql.size(),
          readSql.size());
    }
  }
}
