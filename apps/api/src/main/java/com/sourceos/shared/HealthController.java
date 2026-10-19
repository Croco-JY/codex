package com.sourceos.shared;

import org.springframework.web.bind.annotation.*;

@RestController
class HealthController {
  private final org.springframework.jdbc.core.simple.JdbcClient jdbc;

  HealthController(org.springframework.jdbc.core.simple.JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public record Health(String status, String application) {}

  @GetMapping("/api/health")
  public Health health() {
    jdbc.sql("SELECT 1").query(Integer.class).single();
    return new Health("UP", "SOURCE OS");
  }
}
