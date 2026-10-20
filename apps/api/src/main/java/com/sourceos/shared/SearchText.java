package com.sourceos.shared;

import java.text.Normalizer;
import java.util.Locale;

public final class SearchText {
  private SearchText() {}

  public static String normalize(String text) {
    return Normalizer.normalize(text, Normalizer.Form.NFKC).strip().toLowerCase(Locale.ROOT);
  }

  public static String like(String text) {
    return "%"
        + normalize(text).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        + "%";
  }
}
