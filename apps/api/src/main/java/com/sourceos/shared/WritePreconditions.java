package com.sourceos.shared;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Explicit create intent for versioned child-resource PUT operations. */
public final class WritePreconditions {
  private WritePreconditions() {}

  public static final String DESCRIPTION =
      "Use * for atomic create-only with body version 0; an existing target returns 412. "
          + "Omit for update-only: missing target returns 404, stale version returns 409. "
          + "Blank, multiple, or other values and nonzero create versions return 400.";

  public static boolean createOnly(String ifNoneMatch, long version) {
    if (ifNoneMatch == null) return false;
    // HTTP optional whitespace is SP / HTAB, not arbitrary Unicode whitespace or ETag syntax.
    String value = ifNoneMatch.replaceAll("^[ \\t]+|[ \\t]+$", "");
    if (!"*".equals(value) || version != 0)
      throw ValidationRules.bad("Invalid create-only precondition");
    return true;
  }

  public static ResponseStatusException failed() {
    return new ResponseStatusException(
        HttpStatus.PRECONDITION_FAILED, "Create-only precondition failed; resource already exists");
  }
}
