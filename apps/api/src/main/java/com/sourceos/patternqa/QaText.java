package com.sourceos.patternqa;

import com.sourceos.shared.ValidationRules;

/** Fixed Unicode boundary set, independently owned; identical to V22 and frontend. */
public final class QaText {
  private QaText() {}

  public static boolean boundary(int cp) {
    return (cp >= 9 && cp <= 13)
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

  public static String notes(String value) {
    if (value == null) throw ValidationRules.bad("QA notes required");
    int start = 0, end = value.length();
    while (start < end && boundary(value.codePointAt(start)))
      start += Character.charCount(value.codePointAt(start));
    while (end > start && boundary(value.codePointBefore(end)))
      end -= Character.charCount(value.codePointBefore(end));
    String result = value.substring(start, end);
    if (result.isEmpty()
        || result.codePointCount(0, result.length()) > 2000
        || result.codePoints().anyMatch(cp -> cp == 0 || (cp >= 0xd800 && cp <= 0xdfff)))
      throw ValidationRules.bad("Invalid QA notes");
    return result;
  }
}
