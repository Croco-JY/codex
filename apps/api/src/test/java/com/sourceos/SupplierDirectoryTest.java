package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.dataingestion.SourceService;
import com.sourceos.supplier.SupplierService;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;

class SupplierDirectoryTest extends DirectoryIntegrationSupport {
  @Test
  void supplierExistsWithoutAccountAndHasMultipleRoles() {
    int count = jdbc.sql("SELECT count(*) FROM organization").query(Integer.class).single();
    var s = supplier(JP, "Synthetic independent " + id());
    assertThat(s.roles())
        .containsExactlyInAnyOrder(
            SupplierService.Role.MILL, SupplierService.Role.MATERIAL_SUPPLIER);
    assertThat(s.verificationStatus()).isEqualTo(SupplierService.Verification.DISCOVERED);
    assertThat(jdbc.sql("SELECT count(*) FROM organization").query(Integer.class).single())
        .isEqualTo(count);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM information_schema.columns WHERE"
                        + " table_name='supplier_profile' AND column_name IN"
                        + " ('organization_id','active')")
                .query(Integer.class)
                .single())
        .isZero();
  }

  @Test
  void equalNamesDoNotMerge() {
    String name = "Synthetic duplicate " + id();
    assertThat(supplier(JP, name).id()).isNotEqualTo(supplier(JP, name).id());
  }

  @Test
  void aliasesPreserveOriginalAndSearchNormalization() {
    var s = supplier(JP, "Synthetic alias " + id());
    String alias = "ＳＯＵＲＣＥ 日本 " + id();
    suppliers.alias(
        s.id(),
        new SupplierService.AliasInput(
            alias, "ja", SupplierService.AliasType.COMMERCIAL, observation, s.version()));
    assertThat(suppliers.aliases(s.id()).getFirst().alias()).isEqualTo(alias);
    assertThat(
            search
                .suppliers(
                    filter(
                        "source 日本 " + alias.substring(alias.lastIndexOf(' ') + 1),
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null),
                    25,
                    null)
                .items())
        .extracting(x -> x.id())
        .containsExactly(s.id());
  }

  @Test
  void verificationUpdatesHistoryAndAuditAtomically() {
    var s = supplier(KR, "Synthetic verify " + id());
    var verified =
        suppliers.verify(
            s.id(),
            new SupplierService.VerificationInput(
                SupplierService.Verification.VERIFIED,
                "Evidence reviewed",
                observation,
                s.version()));
    assertThat(verified.version()).isEqualTo(1);
    assertThat(suppliers.events(s.id())).hasSize(2);
    assertThat(suppliers.events(s.id()).getFirst().actorSubject()).isEqualTo(principal);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM audit_event WHERE entity_id=:id AND"
                        + " action='supplier.verification.changed' AND scope='PLATFORM'")
                .param("id", s.id())
                .query(Integer.class)
                .single())
        .isEqualTo(1);
  }

  @Test
  void verificationRollsBackIfAuditCannotBeWritten() {
    var s = supplier(JP, "Synthetic rollback " + id());
    jdbc.sql(
            "CREATE FUNCTION reject_verification_test() RETURNS trigger LANGUAGE plpgsql AS $$"
                + " BEGIN IF NEW.action='supplier.verification.changed' THEN RAISE EXCEPTION 'test"
                + " audit refusal' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$")
        .update();
    jdbc.sql(
            "CREATE TRIGGER test_audit_refusal BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE"
                + " FUNCTION reject_verification_test()")
        .update();
    try {
      assertThatThrownBy(
              () ->
                  suppliers.verify(
                      s.id(),
                      new SupplierService.VerificationInput(
                          SupplierService.Verification.VERIFIED, "Evidence", observation, 0)))
          .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
      assertThat(suppliers.read(s.id()).verificationStatus())
          .isEqualTo(SupplierService.Verification.DISCOVERED);
      assertThat(suppliers.read(s.id()).version()).isZero();
      assertThat(suppliers.events(s.id())).hasSize(1);
    } finally {
      jdbc.sql("DROP TRIGGER test_audit_refusal ON audit_event").update();
      jdbc.sql("DROP FUNCTION reject_verification_test()").update();
    }
  }

  @Test
  void futureProofStatesCannotBeForged() {
    var s = supplier(JP, "Synthetic future " + id());
    for (var status :
        List.of(
            SupplierService.Verification.CLAIMED,
            SupplierService.Verification.TRANSACTED,
            SupplierService.Verification.PROVEN))
      assertThatThrownBy(
              () ->
                  suppliers.verify(
                      s.id(),
                      new SupplierService.VerificationInput(
                          status, "No workflow proof", observation, 0)))
          .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
  }

  @Test
  void typedBindingRequiresSupplierRecordAndIsUnique() {
    var a = supplier(JP, "Synthetic binding A " + id());
    var b = supplier(JP, "Synthetic binding B " + id());
    UUID wrong =
        sources
            .record(
                new SourceService.RecordInput(
                    source, SourceService.RecordKind.FACILITY, "wrong-kind"))
            .id();
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        "INSERT INTO supplier_external_record(source_record_id,supplier_id)"
                            + " VALUES(:record,:supplier)")
                    .param("record", wrong)
                    .param("supplier", a.id())
                    .update())
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    suppliers.bindIdentity(a.id(), record);
    assertThatThrownBy(() -> suppliers.bindIdentity(b.id(), record))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        "UPDATE supplier_external_record SET supplier_id=:b WHERE"
                            + " source_record_id=:record")
                    .param("b", b.id())
                    .param("record", record)
                    .update())
        .hasMessageContaining("append-only");
  }

  @Test
  void oneSupplierCanHaveMultipleExternalIdentities() {
    var s = supplier(JP, "Synthetic identities " + id());
    suppliers.bindIdentity(s.id(), record);
    UUID second =
        sources
            .record(
                new SourceService.RecordInput(source, SourceService.RecordKind.SUPPLIER, "other"))
            .id();
    suppliers.bindIdentity(s.id(), second);
    assertThat(
            jdbc.sql("SELECT count(*) FROM supplier_external_record WHERE supplier_id=:id")
                .param("id", s.id())
                .query(Integer.class)
                .single())
        .isEqualTo(2);
  }

  @Test
  void concurrentImportReusesCanonicalIdentity() throws Exception {
    UUID importRecord =
        sources
            .record(
                new SourceService.RecordInput(
                    source, SourceService.RecordKind.SUPPLIER, "import-once"))
            .id();
    UUID obs = observation(importRecord);
    var input =
        new SupplierService.Input(
            JP,
            "Synthetic imported",
            null,
            null,
            null,
            null,
            null,
            null,
            SupplierService.Status.ACTIVE,
            Set.of(),
            obs,
            0);
    var command = new SupplierService.IdentityInput(importRecord, input);
    try (var pool = Executors.newFixedThreadPool(2)) {
      Callable<UUID> task =
          () -> {
            actor(principal);
            try {
              return suppliers.resolveIdentity(command).id();
            } finally {
              org.springframework.security.core.context.SecurityContextHolder.clearContext();
            }
          };
      var x = pool.submit(task);
      var y = pool.submit(task);
      UUID first = x.get(10, TimeUnit.SECONDS);
      assertThat(y.get(10, TimeUnit.SECONDS)).isEqualTo(first);
      assertThat(suppliers.resolveIdentity(command).id()).isEqualTo(first);
      assertThat(
              jdbc.sql("SELECT count(*) FROM supplier_external_record WHERE source_record_id=:id")
                  .param("id", importRecord)
                  .query(Integer.class)
                  .single())
          .isEqualTo(1);
    }
  }

  @Test
  void citationReferencesObservationNotRecord() {
    var s = supplier(JP, "Synthetic citation " + id());
    assertThatThrownBy(
            () ->
                suppliers.citation(
                    s.id(), new SupplierService.Citation(record, SupplierService.Fact.WEBSITE_URL)))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    suppliers.citation(
        s.id(), new SupplierService.Citation(observation, SupplierService.Fact.WEBSITE_URL));
    assertThat(suppliers.citations(s.id())).hasSize(2);
  }

  private void link(UUID supplier, UUID org, String status) {
    jdbc.sql(
            "INSERT INTO"
                + " supplier_organization_link(id,supplier_profile_id,organization_id,status,linked_by_issuer,linked_by_subject)"
                + " VALUES(:id,:supplier,:org,:status,'urn:source-os:local','fixture-operator')")
        .param("id", id())
        .param("supplier", supplier)
        .param("org", org)
        .param("status", status)
        .update();
  }

  @Test
  void linksOnlyActiveRevokedAndOneActivePerSupplier() {
    var a = supplier(JP, "Synthetic link A " + id());
    var b = supplier(JP, "Synthetic link B " + id());
    UUID org = id(), other = id();
    for (UUID key : List.of(org, other))
      jdbc.sql("INSERT INTO organization(id,name) VALUES(:id,'Synthetic linked account')")
          .param("id", key)
          .update();
    link(a.id(), org, "ACTIVE");
    link(b.id(), org, "ACTIVE");
    assertThatThrownBy(() -> link(a.id(), other, "ACTIVE"))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(() -> link(b.id(), other, "PENDING"))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    jdbc.sql(
            "UPDATE supplier_organization_link SET"
                + " status='REVOKED',revoked_at=now(),revoked_by_issuer='urn:source-os:local',revoked_by_subject='operator',version=version+1"
                + " WHERE supplier_profile_id=:id")
        .param("id", a.id())
        .update();
    link(a.id(), other, "ACTIVE");
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM supplier_organization_link WHERE supplier_profile_id=:id")
                .param("id", a.id())
                .query(Integer.class)
                .single())
        .isEqualTo(2);
  }

  @Test
  void optimisticSupplierConflict() {
    var s = supplier(JP, "Synthetic locking " + id());
    var changed = suppliers.update(s.id(), supplierInput(JP, "Synthetic changed", 0));
    assertThat(changed.version()).isEqualTo(1);
    assertThatThrownBy(() -> suppliers.update(s.id(), supplierInput(JP, "Stale", 0)))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
  }

  @Test
  void httpAuthorizationAndActorSpoofing() throws Exception {
    var input = supplierInput(JP, "Synthetic HTTP " + id(), 0);
    String body = new tools.jackson.databind.ObjectMapper().writeValueAsString(input);
    mvc.perform(post("/api/v1/admin/suppliers").contentType("application/json").content(body))
        .andExpect(status().isUnauthorized());
    UUID org = id();
    jdbc.sql("INSERT INTO organization(id,name) VALUES(:id,'Tenant')").param("id", org).update();
    jdbc.sql(
            "INSERT INTO membership(id,organization_id,issuer,subject,role)"
                + " VALUES(:id,:org,'urn:source-os:local','org-owner-http','ORG_OWNER')")
        .param("id", id())
        .param("org", org)
        .update();
    actor(principal);
    var existing = supplier(JP, "Synthetic linked HTTP " + id());
    link(existing.id(), org, "ACTIVE");
    mvc.perform(
            post("/api/v1/admin/suppliers")
                .header("X-Dev-Subject", "org-owner-http")
                .contentType("application/json")
                .content(body))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/v1/admin/suppliers")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(body.substring(0, body.length() - 1) + ",\"actor_subject\":\"forged\"}"))
        .andExpect(status().isBadRequest());
    mvc.perform(
            post("/api/v1/admin/suppliers")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.verificationStatus").value("DISCOVERED"));
    mvc.perform(
            get("/api/v1/suppliers/" + existing.id()).header("X-Dev-Subject", "different-org-user"))
        .andExpect(status().isOk());
    mvc.perform(
            post("/api/v1/admin/claims")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content("{}"))
        .andExpect(status().isNotFound());
  }

  @Test
  void schemaHasNoSecondUsersOrPhaseTwo() {
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND"
                        + " table_name IN"
                        + " ('app_user','user_identity','user','rfq','quote','production_order','shipment','payment')")
                .query(Integer.class)
                .single())
        .isZero();
    assertThat(
            jdbc.sql(
                    "SELECT version FROM flyway_schema_history WHERE success ORDER BY"
                        + " installed_rank DESC LIMIT 1")
                .query(String.class)
                .single())
        .isEqualTo("11");
  }
}
