package com.sourceos;

import static org.assertj.core.api.Assertions.*;
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

/** Actual embedded Servlet multipart parsing, including multiplicity and transport limits. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class StyleDevelopmentReferenceMultipartTest extends StyleDevelopmentReferenceSupport {
  @Value("${local.server.port}")
  int serverPort;

  record Part(String name, byte[] value, boolean file) {}

  Part name() {
    return new Part("displayName", "샘플 자료 01".getBytes(StandardCharsets.UTF_8), false);
  }

  Part file(int size) {
    byte[] bytes = new byte[size];
    Arrays.fill(bytes, (byte) 37);
    return new Part("file", bytes, true);
  }

  HttpResponse<byte[]> post(List<Part> parts, String mime, String subject) throws Exception {
    String boundary = "SourceSyntheticBoundary";
    var body = new ByteArrayOutputStream();
    for (var part : parts) {
      body.write(
          ("--"
                  + boundary
                  + "\r\nContent-Disposition: form-data; name=\""
                  + part.name()
                  + "\""
                  + (part.file() ? "; filename=\"untrusted.html\"" : "")
                  + "\r\nContent-Type: "
                  + (part.file() ? mime : "text/plain; charset=UTF-8")
                  + "\r\n\r\n")
              .getBytes(StandardCharsets.UTF_8));
      body.write(part.value());
      body.write("\r\n".getBytes(StandardCharsets.UTF_8));
    }
    body.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
    var request =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + serverPort + path()))
            .header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .header("X-Dev-Subject", subject)
            .header("X-Request-ID", "multipart-reference")
            .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
            .build();
    return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofByteArray());
  }

  @Test
  void exactTenMiBPlusEnvelopeSucceedsAndDownloadsIdentically() throws Exception {
    var response = post(List.of(name(), file(10485760)), "text/html", owner);
    assertThat(response.statusCode()).isEqualTo(201);
    var v = json.readTree(response.body());
    assertThat(v.get("state").asString()).isEqualTo("READY");
    assertThat(v.get("version").asLong()).isEqualTo(1);
    assertThat(v.get("sizeBytes").asLong()).isEqualTo(10485760);
    assertThat(v.get("mediaType").asString()).isEqualTo("application/octet-stream");
    actor(owner);
    assertThat(
            references
                .content(
                    org,
                    project.id(),
                    style.id(),
                    UUID.fromString(v.get("id").asString()),
                    "download")
                .bytes())
        .isEqualTo(file(10485760).value());
  }

  @Test
  void oneByteOverFileLimitIsSafe413WithoutSideEffects() throws Exception {
    var response = post(List.of(name(), file(10485761)), "application/pdf", owner);
    assertThat(response.statusCode()).isEqualTo(413);
    var p = json.readTree(response.body());
    assertThat(p.get("status").asInt()).isEqualTo(413);
    assertThat(p.get("requestId").asString()).isEqualTo("multipart-reference");
    assertThat(new String(response.body(), StandardCharsets.UTF_8))
        .doesNotContain("tmp/", "FileUpload", "Exception");
    actor(owner);
    assertThat(references.list(org, project.id(), style.id(), null, 25, 0).items()).isEmpty();
    verifyNoInteractions(port);
    assertThat(lifecycle("upload_started")).isZero();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "unknown",
        "duplicate-name",
        "duplicate-file",
        "missing-name",
        "missing-file",
        "empty"
      })
  void invalidActualPartMultisetOrEmptyFileNeverReserves(String kind) throws Exception {
    var parts = new ArrayList<>(List.of(name(), file(3)));
    switch (kind) {
      case "unknown" ->
          parts.add(
              new Part("storageObjectId", "synthetic".getBytes(StandardCharsets.UTF_8), false));
      case "duplicate-name" -> parts.add(name());
      case "duplicate-file" -> parts.add(file(4));
      case "missing-name" -> parts.remove(0);
      case "missing-file" -> parts.remove(1);
      case "empty" -> parts.set(1, file(0));
    }
    assertThat(post(parts, "image/png", owner).statusCode()).isEqualTo(400);
    actor(owner);
    assertThat(references.list(org, project.id(), style.id(), null, 25, 0).items()).isEmpty();
    verifyNoInteractions(port);
    assertThat(lifecycle("upload_started")).isZero();
  }

  @ParameterizedTest
  @ValueSource(strings = {"image/png", "text/html", "application/pdf"})
  void userMimeAndOriginalFilenameNeverDefinePersistedMedia(String mime) throws Exception {
    var response = post(List.of(name(), file(3)), mime, owner);
    assertThat(response.statusCode()).isEqualTo(201);
    var v = json.readTree(response.body());
    assertThat(v.get("mediaType").asString()).isEqualTo("application/octet-stream");
    assertThat(v.get("displayName").asString()).isEqualTo("샘플 자료 01");
  }

  @Test
  void viewerCannotUploadAndUnknownAuthorityPartCannotAttachExistingObject() throws Exception {
    String viewer = "viewer-" + id();
    membership(org, viewer, "VIEWER", "ACTIVE");
    assertThat(post(List.of(name(), file(3)), "text/html", viewer).statusCode()).isEqualTo(403);
    verifyNoInteractions(port);
  }

  @Test
  void generatedMultipartAndBinaryDownloadContract() throws Exception {
    var response =
        HttpClient.newHttpClient()
            .send(
                HttpRequest.newBuilder(
                        URI.create("http://127.0.0.1:" + serverPort + "/v3/api-docs"))
                    .GET()
                    .build(),
                HttpResponse.BodyHandlers.ofString());
    var spec = json.readTree(response.body());
    String route =
        "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/development-references";
    var request = spec.get("paths").get(route).get("post").get("requestBody");
    assertThat(request.get("required").asBoolean()).isTrue();
    var schema = request.get("content").get("multipart/form-data").get("schema");
    if (schema.has("$ref"))
      schema =
          spec.get("components")
              .get("schemas")
              .get(schema.get("$ref").asString().replace("#/components/schemas/", ""));
    assertThat(schema.get("properties").propertyNames())
        .containsExactlyInAnyOrder("displayName", "file");
    assertThat(schema.get("required").valueStream().map(v -> v.asString()).toList())
        .containsExactlyInAnyOrder("displayName", "file");
    assertThat(schema.get("properties").get("file").get("format").asString()).isEqualTo("binary");
    var binary =
        spec.get("paths")
            .get(route + "/{referenceId}/content")
            .get("get")
            .get("responses")
            .get("200")
            .get("content")
            .get("application/octet-stream")
            .get("schema");
    assertThat(binary.get("format").asString()).isEqualTo("binary");
  }
}
