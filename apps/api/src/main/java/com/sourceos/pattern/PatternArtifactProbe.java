package com.sourceos.pattern;

import com.sourceos.shared.ValidationRules;
import io.swagger.v3.oas.annotations.media.Schema;

/** Pure probe-v1 byte envelope inspection. No semantic parser, decoding, IO or geometry claim. */
public final class PatternArtifactProbe {
  private PatternArtifactProbe() {}

  @Schema(name = "PatternArtifactDeclaredFormat", enumAsRef = true)
  public enum Format {
    DXF_AAMA,
    DXF_ASTM,
    PDF
  }

  public static final int MAX_LINE = 8192, MAX_PAIRS = 1_000_000;

  private static RuntimeException bad() {
    return ValidationRules.bad("Artifact structural envelope rejected");
  }

  private static boolean whitespace(byte b) {
    return b == 32 || b == 9 || b == 13 || b == 10;
  }

  private static boolean token(byte[] b, int start, int end, String token) {
    while (start < end && (b[start] == 32 || b[start] == 9)) start++;
    while (end > start && (b[end - 1] == 32 || b[end - 1] == 9)) end--;
    if (end - start != token.length()) return false;
    for (int i = 0; i < token.length(); i++)
      if (b[start + i] != (byte) token.charAt(i)) return false;
    return true;
  }

  private static boolean starts(byte[] b, String s) {
    if (b.length < s.length()) return false;
    for (int i = 0; i < s.length(); i++) if (b[i] != (byte) s.charAt(i)) return false;
    return true;
  }

  private record Line(int start, int end, int next) {}

  // LF, CRLF and standalone CR are supported explicitly, never double-counting CRLF.
  private static Line line(byte[] b, int at) {
    int end = at;
    while (end < b.length && b[end] != 10 && b[end] != 13) {
      if (end - at >= MAX_LINE) throw bad();
      end++;
    }
    int next = end;
    if (next < b.length) {
      byte separator = b[next++];
      if (separator == 13 && next < b.length && b[next] == 10) next++;
    }
    return new Line(at, end, next);
  }

  public static void inspect(Format format, byte[] b) {
    if (format == null || b.length == 0) throw bad();
    if (format == Format.PDF) {
      int end = b.length;
      while (end > 0 && whitespace(b[end - 1])) end--;
      if (!starts(b, "%PDF-") || end < 5 || !token(b, end - 5, end, "%%EOF")) throw bad();
      return;
    }
    if (starts(b, "AutoCAD Binary DXF")) throw bad();
    for (byte value : b) if (value == 0) throw bad();
    int at = 0, pairs = 0;
    boolean section = false;
    while (at < b.length) {
      if (++pairs > MAX_PAIRS) throw bad();
      var code = line(b, at);
      if (code.next() == b.length) throw bad();
      var value = line(b, code.next());
      int lo = code.start(), hi = code.end();
      while (lo < hi && (b[lo] == 32 || b[lo] == 9)) lo++;
      while (hi > lo && (b[hi - 1] == 32 || b[hi - 1] == 9)) hi--;
      if (lo == hi) throw bad();
      int n = 0;
      for (int i = lo; i < hi; i++) {
        if (b[i] < '0' || b[i] > '9') throw bad();
        n = n * 10 + b[i] - '0';
        if (n > 1071) throw bad();
      }
      if (n == 0 && token(b, value.start(), value.end(), "SECTION")) section = true;
      if (n == 0 && token(b, value.start(), value.end(), "EOF")) {
        if (!section) throw bad();
        for (int i = value.next(); i < b.length; i++) if (!whitespace(b[i])) throw bad();
        return;
      }
      at = value.next();
    }
    throw bad();
  }
}
