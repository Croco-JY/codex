package com.sourceos.pattern;

import com.sourceos.file.AuthorizedStorage;
import com.sourceos.shared.ValidationRules;
import io.swagger.v3.oas.annotations.media.Schema;
import java.io.*;
import java.security.*;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.*;
import tools.jackson.databind.*;
import tools.jackson.databind.annotation.JsonDeserialize;

@Service
public class PatternArtifactService {
  @Schema(name = "PatternArtifactState", enumAsRef = true)
  public enum State {
    PENDING,
    READY,
    FAILED
  }

  @Schema(name = "PatternArtifactFailureCode", enumAsRef = true)
  public enum Failure {
    STORAGE_WRITE_FAILED,
    STORAGE_READBACK_FAILED,
    STORAGE_INTEGRITY_MISMATCH
  }

  @Schema(
      name = "PatternArtifactRevisionCreateInput",
      requiredProperties = {
        "expectedLatestRevisionNumber",
        "name",
        "declaredFormat",
        "displayName"
      },
      additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
  public record Input(
      @Schema(minimum = "1", maximum = "9007199254740991")
          @JsonDeserialize(using = PatternService.IntegerInput.class)
          Long expectedLatestRevisionNumber,
      @Schema(minLength = 1, maxLength = 160)
          @JsonDeserialize(using = PatternService.TextInput.class)
          String name,
      @Schema(
              types = {"string", "null"},
              maxLength = 160)
          @JsonDeserialize(using = PatternService.TextInput.class)
          String purpose,
      @Schema(
              types = {"string", "null"},
              format = "uuid")
          @JsonDeserialize(using = PatternService.UuidInput.class)
          UUID measurementRevisionId,
      @JsonDeserialize(using = FormatInput.class) PatternArtifactProbe.Format declaredFormat,
      @Schema(minLength = 1, maxLength = 255)
          @JsonDeserialize(using = PatternService.TextInput.class)
          String displayName) {}

  static class FormatInput extends ValueDeserializer<PatternArtifactProbe.Format> {
    public PatternArtifactProbe.Format deserialize(JsonParser p, DeserializationContext c) {
      if (!p.hasToken(JsonToken.VALUE_STRING))
        throw ValidationRules.bad("Declared format required");
      try {
        return PatternArtifactProbe.Format.valueOf(p.getString());
      } catch (IllegalArgumentException e) {
        throw ValidationRules.bad("Invalid declared format");
      }
    }
  }

  @Schema(
      name = "PatternArtifactView",
      requiredProperties = {
        "id",
        "patternRevisionId",
        "patternId",
        "styleId",
        "declaredFormat",
        "displayName",
        "sizeBytes",
        "state",
        "failureCode",
        "createdAt",
        "updatedAt"
      })
  public record View(
      UUID id,
      UUID patternRevisionId,
      UUID patternId,
      UUID styleId,
      PatternArtifactProbe.Format declaredFormat,
      String displayName,
      @Schema(minimum = "1", maximum = "10485760") long sizeBytes,
      State state,
      @Schema(
              types = {"string", "null"},
              description =
                  "Null for PENDING/READY. FAILED uses STORAGE_WRITE_FAILED,"
                      + " STORAGE_READBACK_FAILED or STORAGE_INTEGRITY_MISMATCH.")
          String failureCode,
      Instant createdAt,
      Instant updatedAt) {}

  @Schema(
      name = "PatternArtifactRevisionResult",
      requiredProperties = {"revision", "artifact"})
  public record Result(PatternService.RevisionView revision, View artifact) {}

  public record Content(View metadata, byte[] bytes) {}

  @FunctionalInterface
  public interface BinaryInput {
    InputStream open() throws IOException;
  }

  private final PatternArtifactTransactions tx;
  private final AuthorizedStorage storage;

  public PatternArtifactService(PatternArtifactTransactions tx, AuthorizedStorage storage) {
    this.tx = tx;
    this.storage = storage;
  }

  static String text(String s, int max, boolean required) {
    if (s != null) s = s.replaceAll("^[\\s\\p{Z}\\uFEFF]+|[\\s\\p{Z}\\uFEFF]+$", "");
    if (s != null && s.isEmpty()) s = null;
    if ((required && s == null) || (s != null && s.length() > max))
      throw ValidationRules.bad("Invalid artifact metadata");
    return s;
  }

  static String safeName(String raw) {
    String n = text(raw, 255, true);
    if (n.equals(".")
        || n.equals("..")
        || n.indexOf('/') >= 0
        || n.indexOf('\\') >= 0
        || n.codePoints().anyMatch(Character::isISOControl))
      throw ValidationRules.bad("Invalid display name");
    return n;
  }

  static Input checked(Input i) {
    if (i == null
        || i.expectedLatestRevisionNumber() == null
        || i.expectedLatestRevisionNumber() < 1
        || i.expectedLatestRevisionNumber() > PatternService.MAX
        || i.declaredFormat() == null) throw ValidationRules.bad("Invalid artifact metadata");
    return new Input(
        i.expectedLatestRevisionNumber(),
        text(i.name(), 160, true),
        text(i.purpose(), 160, false),
        i.measurementRevisionId(),
        i.declaredFormat(),
        safeName(i.displayName()));
  }

  static String sha(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 unavailable");
    }
  }

  private ResponseStatusException storageFailure() {
    return new ResponseStatusException(
        HttpStatus.INTERNAL_SERVER_ERROR, "Artifact storage verification failed");
  }

  private void failed(
      UUID org,
      UUID project,
      UUID style,
      UUID pattern,
      UUID revision,
      Failure code,
      String request) {
    try {
      tx.finish(org, project, style, pattern, revision, State.FAILED, code, request);
    } catch (RuntimeException blocked) {
      /* Retain reservation/bytes; never bypass authorization or lifecycle. */
    }
  }

  @Transactional(propagation = Propagation.NEVER)
  public Result upload(
      UUID org,
      UUID project,
      UUID style,
      UUID pattern,
      Input raw,
      BinaryInput input,
      String request) {
    var metadata = checked(raw);
    tx.preflight(org, project, style, pattern, metadata);
    byte[] bytes;
    try (var stream = input.open()) {
      bytes = stream.readNBytes(AuthorizedStorage.MAX_BYTES + 1);
    } catch (IOException e) {
      throw storageFailure();
    }
    if (bytes.length == 0) throw ValidationRules.bad("Empty artifact");
    if (bytes.length > AuthorizedStorage.MAX_BYTES)
      throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Artifact too large");
    PatternArtifactProbe.inspect(metadata.declaredFormat(), bytes);
    String hash = sha(bytes);
    var reservation =
        tx.reserve(org, project, style, pattern, metadata, bytes.length, hash, request);
    UUID revision = reservation.revision().id();
    try {
      storage.putNew(org, reservation.stored().object(), bytes);
    } catch (IOException e) {
      failed(org, project, style, pattern, revision, Failure.STORAGE_WRITE_FAILED, request);
      throw storageFailure();
    }
    byte[] readback;
    try {
      readback = storage.get(org, reservation.stored().object());
    } catch (IOException e) {
      failed(org, project, style, pattern, revision, Failure.STORAGE_READBACK_FAILED, request);
      throw storageFailure();
    }
    if (readback.length != bytes.length || !sha(readback).equals(hash)) {
      failed(org, project, style, pattern, revision, Failure.STORAGE_INTEGRITY_MISMATCH, request);
      throw storageFailure();
    }
    var ready = tx.finish(org, project, style, pattern, revision, State.READY, null, request);
    return new Result(reservation.revision(), ready);
  }

  @Transactional(propagation = Propagation.NEVER)
  public View read(UUID org, UUID project, UUID style, UUID pattern, UUID revision) {
    return tx.read(org, project, style, pattern, revision).view();
  }

  @Transactional(propagation = Propagation.NEVER)
  public Content content(UUID org, UUID project, UUID style, UUID pattern, UUID revision) {
    var stored = tx.read(org, project, style, pattern, revision);
    if (stored.view().state() != State.READY) throw ValidationRules.conflict();
    byte[] bytes;
    try {
      bytes = storage.get(org, stored.object());
    } catch (IOException e) {
      throw ValidationRules.conflict();
    }
    if (bytes.length != stored.view().sizeBytes() || !sha(bytes).equals(stored.hash()))
      throw ValidationRules.conflict();
    return new Content(stored.view(), bytes);
  }
}
