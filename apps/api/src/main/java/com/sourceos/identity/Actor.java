package com.sourceos.identity;

public record Actor(String issuer, String subject) {
  public Actor {
    if (issuer == null
        || issuer.isBlank()
        || subject == null
        || subject.isBlank()
        || issuer.length() > 500
        || subject.length() > 255) throw new IllegalArgumentException("Invalid identity");
  }
}
