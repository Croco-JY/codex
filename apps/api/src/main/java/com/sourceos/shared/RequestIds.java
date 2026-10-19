package com.sourceos.shared;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIds extends OncePerRequestFilter {
  public static String get(HttpServletRequest request) {
    return (String) request.getAttribute("requestId");
  }

  protected void doFilterInternal(
      HttpServletRequest req, HttpServletResponse res, FilterChain chain)
      throws ServletException, IOException {
    String id = req.getHeader("X-Request-ID");
    if (id == null || !id.matches("[A-Za-z0-9_-]{1,64}")) id = UUID.randomUUID().toString();
    req.setAttribute("requestId", id);
    res.setHeader("X-Request-ID", id);
    MDC.put("requestId", id);
    long start = System.nanoTime();
    try {
      chain.doFilter(req, res);
    } finally {
      LoggerFactory.getLogger(RequestIds.class)
          .atInfo()
          .addKeyValue("module", "http")
          .addKeyValue("method", req.getMethod())
          .addKeyValue(
              "route",
              req.getAttribute(
                  org.springframework.web.servlet.HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE))
          .addKeyValue("status", res.getStatus())
          .addKeyValue("latencyMs", (System.nanoTime() - start) / 1_000_000)
          .log("Request completed");
      MDC.remove("requestId");
    }
  }
}
