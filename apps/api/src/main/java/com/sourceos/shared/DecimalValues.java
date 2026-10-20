package com.sourceos.shared;

import java.math.BigDecimal;

public final class DecimalValues {
  private DecimalValues() {}

  public static void quantity(BigDecimal v, boolean zeroAllowed) {
    if (v == null) return;
    if (v.scale() > 4
        || v.precision() - v.scale() > 15
        || v.signum() < 0
        || (!zeroAllowed && v.signum() == 0))
      throw ValidationRules.bad("Invalid exact decimal value");
  }
}
