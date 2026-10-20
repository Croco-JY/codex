package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.authorization.PlatformAuthorization;
import com.sourceos.identity.Actor;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class PlatformFoundationTest extends SupplyIntegrationSupport {
  @Autowired PlatformAuthorization authorization;
  @Autowired AuditRecorder audit;
  @Autowired PlatformTransactionManager transactions;

  @AfterEach
  void clear() {
    SecurityContextHolder.clearContext();
  }

  @Test
  void noAutomaticAdminAndGrantRevoke() {
    String ordinary = "ordinary-" + id();
    actor(ordinary);
    assertThatThrownBy(authorization::requireAdmin)
        .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    String a = admin();
    actor(a);
    authorization.requireAdmin();
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        "INSERT INTO platform_role_assignment SELECT"
                            + " :id,issuer,subject,role,status,granted_by_issuer,granted_by_subject,granted_at,revoked_by_issuer,revoked_by_subject,revoked_at,version"
                            + " FROM platform_role_assignment WHERE subject=:subject")
                    .param("id", id())
                    .param("subject", a)
                    .update())
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    jdbc.sql(
            "UPDATE platform_role_assignment SET"
                + " status='REVOKED',revoked_at=now(),revoked_by_issuer='urn:source-os:local',revoked_by_subject='operator'"
                + " WHERE subject=:subject")
        .param("subject", a)
        .update();
    assertThatThrownBy(authorization::requireAdmin)
        .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
  }

  @Test
  void orgOwnerIsNotPlatformAdmin() {
    UUID org = id();
    String owner = "owner-" + id();
    jdbc.sql("INSERT INTO organization(id,name) VALUES(:id,'Tenant')").param("id", org).update();
    jdbc.sql(
            "INSERT INTO membership(id,organization_id,issuer,subject,role)"
                + " VALUES(:id,:org,'urn:source-os:local',:subject,'ORG_OWNER')")
        .param("id", id())
        .param("org", org)
        .param("subject", owner)
        .update();
    actor(owner);
    assertThatThrownBy(authorization::requireAdmin)
        .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
  }

  @Test
  void scopedAuditAndGuards() {
    UUID entity = id();
    new TransactionTemplate(transactions)
        .executeWithoutResult(
            tx ->
                audit.platform(
                    new Actor("urn:source-os:local", "operator"),
                    "supplier.updated",
                    "SupplierProfile",
                    entity,
                    "platform-test",
                    Map.of("status", "ACTIVE"),
                    Map.of("status", "ARCHIVED")));
    var row =
        jdbc.sql(
                "SELECT scope,organization_id,before_state::text AS before_state FROM audit_event"
                    + " WHERE entity_id=:id")
            .param("id", entity)
            .query()
            .singleRow();
    assertThat(row).containsEntry("scope", "PLATFORM").containsEntry("organization_id", null);
    assertThat(row.get("before_state").toString()).contains("ACTIVE");
    for (String sql :
        List.of(
            "UPDATE audit_event SET action='tampered' WHERE entity_id=:id",
            "DELETE FROM audit_event WHERE entity_id=:id"))
      assertThatThrownBy(() -> jdbc.sql(sql).param("id", entity).update())
          .hasMessageContaining("append-only");
    assertThatThrownBy(() -> jdbc.sql("TRUNCATE audit_event").update())
        .hasMessageContaining("append-only");
  }

  @Test
  void auditAllowlistRejectsSecretsAndObjects() {
    for (var bad :
        List.of(Map.of("accessToken", "test-value"), Map.of("status", Map.of("raw", "payload")))) {
      assertThatThrownBy(
              () ->
                  new TransactionTemplate(transactions)
                      .executeWithoutResult(
                          tx ->
                              audit.platform(
                                  new Actor("urn:source-os:local", "operator"),
                                  "changed",
                                  "SupplierProfile",
                                  id(),
                                  "test",
                                  null,
                                  bad)))
          .isInstanceOf(IllegalArgumentException.class);
    }
  }

  @Test
  void scopeAndEntityConstraints() {
    for (String values :
        List.of(
            "'PLATFORM',NULL,NULL,NULL",
            "'ORGANIZATION',NULL,'Supplier',gen_random_uuid()",
            "'PLATFORM',NULL,'Supplier',NULL")) {
      assertThatThrownBy(
              () ->
                  jdbc.sql(
                          "INSERT INTO"
                              + " audit_event(id,actor_issuer,actor_subject,action,request_id,scope,organization_id,entity_type,entity_id)"
                              + " SELECT gen_random_uuid(),'issuer','subject','test','request',"
                              + values)
                      .update())
          .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    }
    UUID org = id();
    jdbc.sql("INSERT INTO organization(id,name) VALUES(:id,'Scope test')")
        .param("id", org)
        .update();
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        "INSERT INTO"
                            + " audit_event(id,actor_issuer,actor_subject,action,request_id,scope,organization_id,entity_type,entity_id)"
                            + " VALUES(gen_random_uuid(),'issuer','subject','test','request','PLATFORM',:org,'Supplier',gen_random_uuid())")
                    .param("org", org)
                    .update())
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }
}
