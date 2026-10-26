package com.sourceos.grading;

import com.sourceos.shared.ValidationRules;

/** Explicit Phase 3D boundary policy, identical to V21 grade_text_is_canonical. */
public final class GradingText {
  private GradingText() {}

  public static boolean boundary(int cp) {
    return (cp >= 0x09 && cp <= 0x0d)
        || cp == 0x20
        || cp == 0x85
        || cp == 0xa0
        || cp == 0x1680
        || (cp >= 0x2000 && cp <= 0x200a)
        || cp == 0x2028
        || cp == 0x2029
        || cp == 0x202f
        || cp == 0x205f
        || cp == 0x3000
        || cp == 0xfeff;
  }

  public static String canonical(String value, int maximum, boolean optional) {
    if (value == null) {
      if (optional) return null;
      throw ValidationRules.bad("Grading text required");
    }
    int start = 0, end = value.length();
    while (start < end && boundary(value.codePointAt(start)))
      start += Character.charCount(value.codePointAt(start));
    while (end > start && boundary(value.codePointBefore(end)))
      end -= Character.charCount(value.codePointBefore(end));
    String result = value.substring(start, end);
    if (optional && result.isEmpty()) return null;
    if (result.isEmpty()
        || result.codePointCount(0, result.length()) > maximum
        || result.codePoints().anyMatch(cp -> cp == 0 || (cp >= 0xd800 && cp <= 0xdfff)))
      throw ValidationRules.bad("Invalid grading text");
    return result;
  }
}
