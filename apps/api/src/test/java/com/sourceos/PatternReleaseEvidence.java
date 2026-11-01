package com.sourceos;

import java.nio.file.*;
import tools.jackson.databind.json.JsonMapper;

/** Synthetic integration evidence only; never a production switch or authority API. */
public final class PatternReleaseEvidence {
  private PatternReleaseEvidence() {}

  public static void write(String id, Object value) {
    try {
      Path root = Path.of("target", "pattern-release-evidence");
      Files.createDirectories(root);
      Files.writeString(
          root.resolve(id + ".json"),
          JsonMapper.builder().build().writerWithDefaultPrettyPrinter().writeValueAsString(value));
    } catch (Exception e) {
      throw new AssertionError("Cannot retain release test evidence", e);
    }
  }
}
