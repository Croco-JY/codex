package com.sourceos.audit;

import com.sourceos.identity.Actor;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class AuditRecorder {
  private final JdbcClient jdbc;
  private final com.sourceos.identity.IdentityService identities;

  public AuditRecorder(JdbcClient jdbc, com.sourceos.identity.IdentityService identities) {
    this.identities = identities;
    this.jdbc = jdbc;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void record(Actor actor, UUID org, String action, String requestId) {
    jdbc.sql(
            "INSERT INTO"
                + " audit_event(id,actor_issuer,actor_subject,organization_id,action,request_id)"
                + " VALUES(:id,:issuer,:subject,:org,:action,:request)")
        .param("id", UUID.randomUUID())
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .param("org", org)
        .param("action", action)
        .param("request", requestId)
        .update();
  }

  /** Explicit scalar allowlist: never serialize an entity, request or raw external payload. */
  private static final java.util.Set<String> FIELDS =
      java.util.Set.of(
          "status",
          "verificationStatus",
          "name",
          "displayName",
          "countryId",
          "regionId",
          "clusterId",
          "parentId",
          "supplierId",
          "capabilityId",
          "role",
          "sourceCode",
          "recordKind",
          "observationId",
          "reviewStatus",
          "version",
          "catalogSupplierId",
          "materialType",
          "materialId",
          "variantId",
          "listingId",
          "sellerSupplierId",
          "compositionCompleteness",
          "fiberTypeId",
          "percentage",
          "minimumOrderQuantity",
          "minimumColorQuantity",
          "quantityUnit",
          "standardLeadTimeDays",
          "reproductionLeadTimeDays",
          "sourceId",
          "amount",
          "currency",
          "unit",
          "validTo",
          "quantity",
          "captureMode",
          "projectId",
          "styleId",
          "facilityId",
          "state",
          "sizeBytes",
          "measurementSpecId",
          "measurementRevisionNumber",
          "patternId",
          "patternRevisionNumber",
          "measurementRevisionId");

  private String state(java.util.Map<String, ?> values) {
    if (values == null) return null;
    var clean = new java.util.TreeMap<String, Object>();
    values.forEach(
        (key, value) -> {
          if (!FIELDS.contains(key)) throw new IllegalArgumentException("Unsupported audit field");
          if (value != null
              && !(value instanceof String
                  || value instanceof java.util.UUID
                  || value instanceof Boolean
                  || value instanceof Number))
            throw new IllegalArgumentException("Scalar audit values required");
          if (value instanceof String text
              && (text.length() > 255
                  || text.contains("\n")
                  || text.matches(".*(?:gh[pousr]_|github_pat_|Bearer ).*")))
            throw new IllegalArgumentException("Unsafe audit value");
          clean.put(key, value instanceof java.util.UUID ? value.toString() : value);
        });
    return new tools.jackson.databind.ObjectMapper().writeValueAsString(clean);
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void platform(
      Actor actor,
      String action,
      String entityType,
      UUID entityId,
      String requestId,
      java.util.Map<String, ?> before,
      java.util.Map<String, ?> after) {
    if (entityId == null || entityType == null || entityType.isBlank())
      throw new IllegalArgumentException("Audit target required");
    String b = state(before), a = state(after);
    jdbc.sql(
            "INSERT INTO"
                + " audit_event(id,actor_issuer,actor_subject,scope,action,entity_type,entity_id,request_id,before_state,after_state)"
                + " VALUES(:id,:issuer,:subject,'PLATFORM',:action,:type,:entity,:request,CAST(:before"
                + " AS jsonb),CAST(:after AS jsonb))")
        .param("id", UUID.randomUUID())
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .param("action", action)
        .param("type", entityType)
        .param("entity", entityId)
        .param("request", requestId)
        .param("before", b)
        .param("after", a)
        .update();
  }

  /** Private workspace audit: the Actor comes only from the authenticated context. */
  @Transactional(propagation = Propagation.MANDATORY)
  public void organizationChanged(
      UUID organizationId,
      String action,
      String entityType,
      UUID entityId,
      String requestId,
      java.util.Map<String, ?> before,
      java.util.Map<String, ?> after) {
    if (organizationId == null || entityId == null || entityType == null || entityType.isBlank())
      throw new IllegalArgumentException("Audit target required");
    var actor = identities.current();
    String b = state(before), a = state(after);
    jdbc.sql(
            "INSERT INTO audit_event(id,actor_issuer,actor_subject,organization_id,scope,action,"
                + "entity_type,entity_id,request_id,before_state,after_state)"
                + " VALUES(:id,:issuer,:subject,:org,'ORGANIZATION',:action,:type,:entity,:request,"
                + "CAST(:before AS jsonb),CAST(:after AS jsonb))")
        .param("id", UUID.randomUUID())
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .param("org", organizationId)
        .param("action", action)
        .param("type", entityType)
        .param("entity", entityId)
        .param("request", requestId)
        .param("before", b)
        .param("after", a)
        .update();
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void changed(
      String action,
      String type,
      UUID id,
      java.util.Map<String, ?> before,
      java.util.Map<String, ?> after) {
    var attributes =
        org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
    Object request = attributes == null ? null : attributes.getAttribute("requestId", 0);
    platform(
        identities.current(),
        action,
        type,
        id,
        request == null ? "internal-" + UUID.randomUUID() : request.toString(),
        before,
        after);
  }
}
