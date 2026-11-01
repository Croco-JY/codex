package com.sourceos.patternrelease;

import org.springframework.core.MethodParameter;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.*;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

/** Private release receipts and consents must not enter the browser's HTTP cache. */
@RestControllerAdvice(
    assignableTypes = {
      ReleaseConsentController.class,
      PatternReleaseSourceController.class,
      ReceivedReleaseController.class
    })
class ReleaseCachePolicy implements ResponseBodyAdvice<Object> {
  @Override
  public boolean supports(
      MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
    return true;
  }

  @Override
  public Object beforeBodyWrite(
      Object body,
      MethodParameter returnType,
      MediaType contentType,
      Class<? extends HttpMessageConverter<?>> converterType,
      ServerHttpRequest request,
      ServerHttpResponse response) {
    response.getHeaders().setCacheControl("private, no-store");
    return body;
  }
}
