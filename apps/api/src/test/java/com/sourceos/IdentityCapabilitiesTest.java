package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.authorization.PlatformAuthorization;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;

class IdentityCapabilitiesTest extends SupplyIntegrationSupport {
  @Autowired PlatformAuthorization authorization;

  @Test
  void unauthenticatedIs401() throws Exception {
    SecurityContextHolder.clearContext();
    mvc.perform(get("/api/identity/capabilities")).andExpect(status().isUnauthorized());
  }

  @Test
  void ordinaryActorHasOnlyFalseCapability() throws Exception {
    check("ordinary-" + id(), false);
  }

  @Test
  void orgOwnerHasNoPlatformAuthority() throws Exception {
    check(member("ORG_OWNER"), false);
  }

  @Test
  void supplierLinkedOrgAdminHasNoPlatformAuthority() throws Exception {
    String subject = member("ORG_ADMIN");
    UUID org =
        jdbc.sql("SELECT organization_id FROM membership WHERE subject=:subject")
            .param("subject", subject)
            .query(UUID.class)
            .single();
    UUID supplier = id();
    jdbc.sql(
            "INSERT INTO supplier_profile(id,country_id,display_name,normalized_name)"
                + " VALUES(:id,:country,'Synthetic linked supplier','synthetic linked supplier')")
        .param("id", supplier)
        .param("country", DirectoryIntegrationSupport.JP)
        .update();
    jdbc.sql(
            "INSERT INTO"
                + " supplier_organization_link(id,supplier_profile_id,organization_id,status,linked_by_issuer,linked_by_subject)"
                + " VALUES(:id,:supplier,:org,'ACTIVE','fixture','operator')")
        .param("id", id())
        .param("supplier", supplier)
        .param("org", org)
        .update();
    check(subject, false);
  }

  @Test
  void activeAdminIsTrueAndRevocationIsImmediateForReadAndGuard() throws Exception {
    String subject = admin();
    check(subject, true);
    actor(subject);
    try {
      assertThat(authorization.isAdmin()).isTrue();
      authorization.requireAdmin();
      jdbc.sql(
              "UPDATE platform_role_assignment SET"
                  + " status='REVOKED',revoked_at=now(),revoked_by_issuer='fixture',revoked_by_subject='operator'"
                  + " WHERE issuer='urn:source-os:local' AND subject=:subject")
          .param("subject", subject)
          .update();
      assertThat(authorization.isAdmin()).isFalse();
      assertThatThrownBy(authorization::requireAdmin).isInstanceOf(AccessDeniedException.class);
    } finally {
      SecurityContextHolder.clearContext();
    }
    check(subject, false);
    mvc.perform(get("/api/v1/admin/sources").header("X-Dev-Subject", subject))
        .andExpect(status().isForbidden());
  }

  @Test
  void sameSubjectAtDifferentIssuerDoesNotGrantAdmin() throws Exception {
    String subject = admin();
    jdbc.sql(
            "UPDATE platform_role_assignment SET issuer='https://different-issuer.example' WHERE"
                + " subject=:subject")
        .param("subject", subject)
        .update();
    check(subject, false);
  }

  private String member(String role) {
    UUID org = id();
    String subject = "member-" + id();
    jdbc.sql("INSERT INTO organization(id,name) VALUES(:id,'Synthetic capability tenant')")
        .param("id", org)
        .update();
    jdbc.sql(
            "INSERT INTO membership(id,organization_id,issuer,subject,role)"
                + " VALUES(:id,:org,'urn:source-os:local',:subject,:role)")
        .param("id", id())
        .param("org", org)
        .param("subject", subject)
        .param("role", role)
        .update();
    return subject;
  }

  private void check(String subject, boolean expected) throws Exception {
    mvc.perform(get("/api/identity/capabilities").header("X-Dev-Subject", subject))
        .andExpect(status().isOk())
        .andExpect(
            content()
                .json(
                    "{\"platformAdmin\":" + expected + "}",
                    org.springframework.test.json.JsonCompareMode.STRICT));
  }
}
