package com.sourceos.shared;

import jakarta.servlet.http.*;
import java.io.IOException;
import java.net.URI;
import org.springframework.http.*;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
public class Problems extends ResponseEntityExceptionHandler {
  public static ProblemDetail detail(int status, String message, HttpServletRequest req) {
    var p = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(status), message);
    p.setType(URI.create("urn:source-os:problem:" + status));
    p.setProperty("requestId", RequestIds.get(req));
    return p;
  }

  public static void write(
      HttpServletRequest req, HttpServletResponse res, int status, String message)
      throws IOException {
    res.setStatus(status);
    res.setContentType("application/problem+json");
    // Fixed messages and validated request IDs only; no exception or authentication data.
    res.getWriter()
        .write(
            "{\"type\":\"urn:source-os:problem:"
                + status
                + "\",\"title\":\""
                + HttpStatus.valueOf(status).getReasonPhrase()
                + "\",\"status\":"
                + status
                + ",\"detail\":\""
                + message
                + "\",\"requestId\":\""
                + RequestIds.get(req)
                + "\"}");
  }

  @ExceptionHandler(AccessDeniedException.class)
  ProblemDetail forbidden(AccessDeniedException e, HttpServletRequest req) {
    return detail(403, "Access denied", req);
  }

  @ExceptionHandler(ResponseStatusException.class)
  ProblemDetail status(ResponseStatusException e, HttpServletRequest req) {
    return detail(e.getStatusCode().value(), e.getReason(), req);
  }

  @ExceptionHandler(org.springframework.orm.ObjectOptimisticLockingFailureException.class)
  ProblemDetail conflict(Exception e, HttpServletRequest req) {
    return detail(409, "Organization changed; refresh and retry", req);
  }

  @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
  ProblemDetail integrity(Exception e,HttpServletRequest req){return detail(409,"Data conflicts with an integrity constraint",req);}
  @ExceptionHandler(IllegalArgumentException.class)
  ProblemDetail input(Exception e,HttpServletRequest req){return detail(400,"Invalid input",req);}
  @ExceptionHandler(Exception.class)
  ProblemDetail unexpected(Exception e, HttpServletRequest req) {
    return detail(500, "Unexpected server error", req);
  }

  @Override
  protected ResponseEntity<Object> handleExceptionInternal(
      Exception ex, Object body, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
    var req = ((ServletWebRequest) request).getRequest();
    return new ResponseEntity<>(
        detail(status.value(), HttpStatus.valueOf(status.value()).getReasonPhrase(), req),
        headers,
        status);
  }
}
