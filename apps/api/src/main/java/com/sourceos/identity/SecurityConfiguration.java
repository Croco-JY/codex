package com.sourceos.identity;

import com.sourceos.shared.Problems;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.web.cors.*;

@Configuration
class SecurityConfiguration {
  @Bean
  CorsConfigurationSource cors(@Value("${source.cors-origins}") String origins) {
    var c = new CorsConfiguration();
    var allowed =
        Arrays.stream(origins.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    if (allowed.stream().anyMatch(s -> s.contains("*")))
      throw new IllegalStateException("Explicit CORS origins required");
    c.setAllowedOrigins(allowed);
    c.setAllowedMethods(List.of("GET", "POST", "PATCH", "PUT", "OPTIONS"));
    c.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Request-ID", "X-Dev-Subject"));
    c.setExposedHeaders(List.of("X-Request-ID"));
    var src = new UrlBasedCorsConfigurationSource();
    src.registerCorsConfiguration("/**", c);
    return src;
  }

  private HttpSecurity foundation(HttpSecurity h) throws Exception {
    return h.csrf(c -> c.disable())
        .cors(c -> {})
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            a ->
                a.requestMatchers("/api/health", "/actuator/health/**", "/v3/api-docs/**")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .exceptionHandling(
            e ->
                e.authenticationEntryPoint(
                        (q, r, x) -> Problems.write(q, r, 401, "Authentication required"))
                    .accessDeniedHandler((q, r, x) -> Problems.write(q, r, 403, "Access denied")));
  }

  @Bean
  @Profile("local")
  SecurityFilterChain local(HttpSecurity h, @Value("${server.address:}") String address)
      throws Exception {
    if (!Set.of("127.0.0.1", "::1", "localhost").contains(address))
      throw new IllegalStateException("Local authentication must bind to loopback");
    return foundation(h)
        .addFilterBefore(new LocalIdentityFilter(), AnonymousAuthenticationFilter.class)
        .build();
  }

  @Bean
  @Profile("!local")
  SecurityFilterChain oidc(HttpSecurity h, JwtDecoder decoder) throws Exception {
    return foundation(h)
        .oauth2ResourceServer(
            o ->
                o.jwt(j -> j.decoder(decoder))
                    .authenticationEntryPoint(
                        (q, r, x) -> Problems.write(q, r, 401, "Authentication required"))
                    .accessDeniedHandler((q, r, x) -> Problems.write(q, r, 403, "Access denied")))
        .build();
  }

  @Bean
  @Profile("!local")
  JwtDecoder jwtDecoder(
      @Value("${source.oidc.issuer}") String issuer,
      @Value("${source.oidc.audience}") String audience) {
    if (!issuer.startsWith("https://") || audience.isBlank())
      throw new IllegalStateException("OIDC HTTPS issuer and audience are required");
    NimbusJwtDecoder decoder = JwtDecoders.fromIssuerLocation(issuer);
    OAuth2TokenValidator<Jwt> audienceValidator =
        jwt ->
            jwt.getAudience().contains(audience)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"));
    decoder.setJwtValidator(
        new DelegatingOAuth2TokenValidator<>(
            JwtValidators.createDefaultWithIssuer(issuer), audienceValidator));
    return decoder;
  }
}
