package com.sourceos.shared;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.function.Function;

/** Validated deterministic cursors; no query column or SQL fragment comes from a cursor. */
public final class Keysets {
  private Keysets() {}

  public record Page<T>(List<T> items, String nextCursor) {}

  public record Anchor(Instant at, UUID id) {}

  public static void limit(int limit) {
    if (limit < 1 || limit > 100) throw ValidationRules.bad("Page size must be 1..100");
  }

  public static String hash(Object filter) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(new tools.jackson.databind.ObjectMapper().writeValueAsBytes(filter)));
    } catch (Exception e) {
      throw new IllegalStateException("Cannot encode filter identity", e);
    }
  }

  public static String encode(String kind, String hash, String anchor) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString((kind + "~" + hash + "~" + anchor).getBytes(StandardCharsets.UTF_8));
  }

  public static String decode(String kind, String hash, String cursor) {
    if (cursor == null) return null;
    try {
      if (cursor.length() > 2048 || !cursor.matches("[A-Za-z0-9_-]+"))
        throw new IllegalArgumentException();
      String[] p =
          new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split("~", 3);
      if (p.length != 3 || !p[0].equals(kind) || !p[1].equals(hash) || p[2].isEmpty())
        throw new IllegalArgumentException();
      return p[2];
    } catch (IllegalArgumentException e) {
      throw ValidationRules.bad("Invalid cursor or filter identity");
    }
  }

  public static UUID uuid(String value) {
    if (!value.matches(
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
      throw ValidationRules.bad("Invalid cursor UUID");
    return UUID.fromString(value);
  }

  public static Anchor anchor(String cursor, Object filter, int limit) {
    limit(limit);
    String raw = decode("created-desc", hash(filter), cursor);
    if (raw == null) return new Anchor(null, null);
    try {
      var p = raw.split("\\|", -1);
      if (p.length != 2) throw new IllegalArgumentException();
      return new Anchor(Instant.parse(p[0]), uuid(p[1]));
    } catch (IllegalArgumentException | DateTimeException e) {
      throw ValidationRules.bad("Invalid cursor anchor");
    }
  }

  public static <T> Page<T> page(
      List<T> rows, int limit, Object filter, Function<T, Instant> at, Function<T, UUID> id) {
    boolean more = rows.size() > limit;
    var items = List.copyOf(rows.subList(0, Math.min(limit, rows.size())));
    T last = items.isEmpty() ? null : items.getLast();
    return new Page<>(
        items,
        more ? encode("created-desc", hash(filter), at.apply(last) + "|" + id.apply(last)) : null);
  }

  public static OffsetDateTime time(Instant time) {
    return time == null ? null : OffsetDateTime.ofInstant(time, ZoneOffset.UTC);
  }
}
