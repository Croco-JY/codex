package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PatternArtifactMultipartTest extends PatternArtifactSupport {
  @Value("${local.server.port}")
  int serverPort;

  record Part(String name, byte[] bytes, String contentType, boolean file) {}

  String metadata() {
    return "{\"expectedLatestRevisionNumber\":1,\"name\":\"Artifact"
        + " revision\",\"declaredFormat\":\"PDF\",\"displayName\":\"자료.pdf\"}";
  }

  Part meta(String value, String type) {
    return new Part("metadata", value.getBytes(StandardCharsets.UTF_8), type, false);
  }

  Part meta() {
    return meta(metadata(), "application/json; charset=UTF-8");
  }

  Part file(int size) {
    var b = new byte[size];
    Arrays.fill(b, (byte) 32);
    if (size >= 10) {
      System.arraycopy("%PDF-".getBytes(StandardCharsets.US_ASCII), 0, b, 0, 5);
      System.arraycopy("%%EOF".getBytes(StandardCharsets.US_ASCII), 0, b, size - 5, 5);
    }
    return new Part("file", b, "text/html", true);
  }

  HttpResponse<byte[]> post(List<Part> parts, String subject) throws Exception {
    String boundary = "SourceArtifactBoundary";
    var body = new ByteArrayOutputStream();
    for (var p : parts) {
      body.write(
          ("--"
                  + boundary
                  + "\r\nContent-Disposition: form-data; name=\""
                  + p.name()
                  + "\""
                  + (p.file() ? "; filename=\"exploit.html\"" : "")
                  + "\r\n"
                  + (p.contentType() == null ? "" : "Content-Type: " + p.contentType() + "\r\n")
                  + "\r\n")
              .getBytes(StandardCharsets.UTF_8));
      body.write(p.bytes());
      body.write("\r\n".getBytes(StandardCharsets.UTF_8));
    }
    body.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
    var builder =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + serverPort + uploadPath()))
            .header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .header("X-Request-ID", "artifact-multipart");
    if (subject != null) builder.header("X-Dev-Subject", subject);
    return HttpClient.newHttpClient()
        .send(
            builder.POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build(),
            HttpResponse.BodyHandlers.ofByteArray());
  }

  void noEffects() {
    assertThat(patternCount("pattern_revision")).isEqualTo(1);
    assertThat(events("upload_started")).isZero();
    assertThat(events("ready")).isZero();
    verifyNoInteractions(port);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "unknown",
        "duplicate-metadata",
        "duplicate-file",
        "missing-metadata",
        "missing-file",
        "empty-file"
      })
  void strictRawMultiset(String kind) throws Exception {
    var p = new ArrayList<>(List.of(meta(), file(10)));
    switch (kind) {
      case "unknown" -> p.add(new Part("storageObjectId", new byte[] {1}, "text/plain", false));
      case "duplicate-metadata" -> p.add(meta());
      case "duplicate-file" -> p.add(file(11));
      case "missing-metadata" -> p.remove(0);
      case "missing-file" -> p.remove(1);
      case "empty-file" -> p.set(1, file(0));
    }
    assertThat(post(p, owner).statusCode()).isEqualTo(400);
    noEffects();
  }

  @ParameterizedTest
  @NullSource
  @ValueSource(
      strings = {
        "text/plain",
        "application/octet-stream",
        "application/json; charset=ISO-8859-1",
        "application/json; charset=UTF-16",
        "invalid content type"
      })
  void metadataMediaTypeIs400Not415(String type) throws Exception {
    assertThat(post(List.of(meta(metadata(), type), file(10)), owner).statusCode()).isEqualTo(400);
    noEffects();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "empty",
        "oversize",
        "unknown-property",
        "duplicate-name",
        "duplicate-head",
        "malformed",
        "trailing",
        "short-uuid",
        "numeric-head",
        "numeric-name",
        "wrong-format"
      })
  void strictMetadataJson(String kind) throws Exception {
    String value =
        switch (kind) {
          case "empty" -> "";
          case "oversize" -> " ".repeat(16385);
          case "unknown-property" -> metadata().replace("}", ",\"storageObjectId\":\"caller\"}");
          case "duplicate-name" -> metadata().replace("}", ",\"name\":\"Other\"}");
          case "duplicate-head" -> metadata().replace("}", ",\"expectedLatestRevisionNumber\":2}");
          case "malformed" -> "{not-json";
          case "trailing" -> metadata() + " {}";
          case "short-uuid" -> metadata().replace("}", ",\"measurementRevisionId\":\"1-1-1-1-1\"}");
          case "numeric-head" -> metadata().replace(":1,", ":1.0,");
          case "numeric-name" -> metadata().replace("\"Artifact revision\"", "42");
          default -> metadata().replace("\"PDF\"", "\"AI\"");
        };
    assertThat(post(List.of(meta(value, "application/json"), file(10)), owner).statusCode())
        .isEqualTo(400);
    noEffects();
  }

  @Test
  void exactMetadataAndFileEnvelopeAccepted() throws Exception {
    String m = metadata();
    int bytes = m.getBytes(StandardCharsets.UTF_8).length;
    m += " ".repeat(16384 - bytes);
    var r = post(List.of(meta(m, "application/json"), file(10485760)), owner);
    assertThat(r.statusCode()).isEqualTo(201);
    var v = json.readTree(r.body());
    assertThat(v.get("artifact").get("state").asString()).isEqualTo("READY");
    assertThat(v.get("artifact").get("sizeBytes").asLong()).isEqualTo(10485760);
    assertThat(v.get("artifact").get("displayName").asString()).isEqualTo("자료.pdf");
    assertThat(v.get("artifact").get("declaredFormat").asString()).isEqualTo("PDF");
    actor(owner);
    assertThat(
            artifacts
                .content(
                    org,
                    project.id(),
                    style.id(),
                    family.id(),
                    UUID.fromString(v.get("revision").get("id").asString()))
                .bytes())
        .isEqualTo(file(10485760).bytes());
  }

  @Test
  void oneByteOverTransportIsSafe413BeforeReservation() throws Exception {
    var r = post(List.of(meta(), file(10485761)), owner);
    assertThat(r.statusCode()).isEqualTo(413);
    var p = json.readTree(r.body());
    assertThat(p.get("requestId").asString()).isEqualTo("artifact-multipart");
    assertThat(new String(r.body(), StandardCharsets.UTF_8))
        .doesNotContain("Exception", "/tmp/", "FileUpload");
    noEffects();
  }

  @ParameterizedTest
  @ValueSource(strings = {"OWNER", "ADMIN", "VIEWER", "PLATFORM", "FOREIGN", "NONE"})
  void uploadAuthorization(String role) throws Exception {
    String who =
        switch (role) {
          case "OWNER" -> owner;
          case "ADMIN", "VIEWER" -> {
            String w = "artifact-" + id();
            membership(org, w, role.equals("ADMIN") ? "ORG_ADMIN" : "VIEWER", "ACTIVE");
            yield w;
          }
          case "PLATFORM" -> admin();
          case "FOREIGN" -> foreignOwner;
          default -> null;
        };
    boolean allowed = Set.of("OWNER", "ADMIN").contains(role);
    var r = post(List.of(meta(), file(10)), who);
    assertThat(r.statusCode()).isEqualTo(allowed ? 201 : who == null ? 401 : 403);
    if (!allowed) noEffects();
    else
      assertThat(
              jdbc.sql(
                      "SELECT created_by_subject FROM pattern_revision WHERE pattern_id=:id AND"
                          + " revision_number=2")
                  .param("id", family.id())
                  .query(String.class)
                  .single())
          .isEqualTo(who);
  }

  @Test
  void generatedMultipartExactSchemaAndNoPrivateArtifactFields() throws Exception {
    var r =
        HttpClient.newHttpClient()
            .send(
                HttpRequest.newBuilder(
                        URI.create("http://127.0.0.1:" + serverPort + "/v3/api-docs"))
                    .GET()
                    .build(),
                HttpResponse.BodyHandlers.ofString());
    var s = json.readTree(r.body());
    String p =
        "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/patterns/{patternId}";
    var operation = s.get("paths").get(p + "/artifact-revisions").get("post");
    assertThat(operation.get("operationId").asString()).isEqualTo("createPatternArtifactRevision");
    var dto = s.at("/components/schemas/PatternArtifactMultipart");
    assertThat(dto.get("properties").propertyNames()).containsExactlyInAnyOrder("metadata", "file");
    assertThat(dto.get("required").valueStream().map(n -> n.asString()).toList())
        .containsExactlyInAnyOrder("metadata", "file");
    assertThat(dto.get("properties").get("metadata").get("$ref").asString())
        .isEqualTo("#/components/schemas/PatternArtifactRevisionCreateInput");
    assertThat(dto.get("properties").get("file").get("format").asString()).isEqualTo("binary");
    assertThat(
            s.at("/components/schemas/PatternArtifactRevisionCreateInput/additionalProperties")
                .asBoolean())
        .isFalse();
    assertThat(s.at("/components/schemas/PatternArtifactView/properties").propertyNames())
        .doesNotContain(
            "sha256",
            "storageObjectId",
            "probeVersion",
            "version",
            "createdBySubject",
            "artifactExpected");
  }
}
