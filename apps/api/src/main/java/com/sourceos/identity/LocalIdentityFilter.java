package com.sourceos.identity;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

public class LocalIdentityFilter extends OncePerRequestFilter {
  protected void doFilterInternal(
      HttpServletRequest req, HttpServletResponse res, FilterChain chain)
      throws ServletException, IOException {
    String subject = req.getHeader("X-Dev-Subject");
    if (subject != null && subject.matches("[A-Za-z0-9._@-]{1,255}")) {
      var actor = new Actor("urn:source-os:local", subject);
      SecurityContextHolder.getContext()
          .setAuthentication(new UsernamePasswordAuthenticationToken(actor, null, List.of()));
    }
    chain.doFilter(req, res);
  }
}
