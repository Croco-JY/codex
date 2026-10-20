package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sourceos.dataingestion.SourceService;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpMethod;

class PersistentIdentityHardeningTest extends DirectoryIntegrationSupport {
  @Test
  void verificationActorMustContainNonblankIssuerAndSubject() {
    var supplier = supplier(JP, "Synthetic actor integrity " + id());
    for (String blank : List.of("", "   ")) {
      for (var actor : List.of(List.of(blank, principal), List.of("urn:source-os:local", blank))) {
        assertThatThrownBy(
                () ->
                    jdbc.sql(
                            """
                            INSERT INTO supplier_verification_event
                              (id,supplier_id,new_status,reason,actor_issuer,actor_subject)
                            VALUES(:id,:supplier,'VERIFIED','Synthetic constraint test',:issuer,:subject)
                            """)
                        .param("id", id())
                        .param("supplier", supplier.id())
                        .param("issuer", actor.get(0))
                        .param("subject", actor.get(1))
                        .update())
            .isInstanceOf(DataIntegrityViolationException.class)
            .hasRootCauseInstanceOf(org.postgresql.util.PSQLException.class);
      }
    }
    assertThat(suppliers.events(supplier.id())).hasSize(1);
  }

  @Test
  void unreferencedExternalIdentityCannotBeRekeyedOrDeletedButCanRecordObservations() {
    var input =
        new SourceService.RecordInput(source, SourceService.RecordKind.SUPPLIER, "standalone");
    var external = sources.record(input);
    assertThat(external.firstSeenAt()).isNull();
    assertThatThrownBy(
            () ->
                jdbc.sql("DELETE FROM data_source_record WHERE id=:id")
                    .param("id", external.id())
                    .update())
        .hasMessageContaining("append-only");
    for (String change :
        List.of(
            "id=:replacement",
            "external_record_key='rewritten',normalized_external_record_key='rewritten'")) {
      var update =
          jdbc.sql("UPDATE data_source_record SET " + change + " WHERE id=:id")
              .param("id", external.id());
      if (change.startsWith("id=")) update = update.param("replacement", id());
      var command = update;
      assertThatThrownBy(command::update).hasMessageContaining("External identity is immutable");
    }
    var observed = Instant.parse("2026-10-19T00:00:00Z");
    sources.observe(
        new SourceService.ObservationInput(
            external.id(), "first", observed, null, null, null, null));
    var retry = sources.record(input);
    assertThat(retry.id()).isEqualTo(external.id());
    assertThat(retry.firstSeenAt()).isEqualTo(observed);
    assertThat(retry.lastSeenAt()).isEqualTo(observed);
  }

  @Test
  void historicalFactsAndBindingsRejectUpdateDeleteAndTruncate() {
    var supplier = supplier(JP, "Synthetic persistent binding " + id());
    suppliers.bindIdentity(supplier.id(), record);
    var facility = facility(supplier.id(), JP, null, null);
    UUID facilityRecord =
        sources
            .record(
                new SourceService.RecordInput(source, SourceService.RecordKind.FACILITY, "site"))
            .id();
    facilities.bindIdentity(facility.id(), facilityRecord);
    sources.review(
        observation,
        new SourceService.ReviewInput(SourceService.ReviewStatus.ACCEPTED, null, null, null));
    for (String table :
        List.of(
            "data_source_observation",
            "data_source_observation_review",
            "supplier_verification_event",
            "supplier_external_record",
            "facility_external_record")) {
      String key = table.endsWith("external_record") ? "source_record_id" : "id";
      long before = jdbc.sql("SELECT count(*) FROM " + table).query(Long.class).single();
      assertThat(before).isPositive();
      for (String sql :
          List.of(
              "UPDATE " + table + " SET " + key + "=" + key,
              "DELETE FROM " + table,
              "TRUNCATE " + table + (table.equals("data_source_observation") ? " CASCADE" : ""))) {
        assertThatThrownBy(() -> jdbc.sql(sql).update()).hasMessageContaining("append-only");
      }
      assertThat(jdbc.sql("SELECT count(*) FROM " + table).query(Long.class).single())
          .isEqualTo(before);
    }
    assertThatThrownBy(() -> jdbc.sql("TRUNCATE data_source_record CASCADE").update())
        .hasMessageContaining("append-only");
    assertThat(
            sources
                .record(
                    new SourceService.RecordInput(
                        source, SourceService.RecordKind.SUPPLIER, "root"))
                .id())
        .isEqualTo(record);
  }

  @Test
  void historyAndExternalIdentityApisRejectDestructiveMethodsEvenForPlatformAdmin()
      throws Exception {
    var id = id();
    for (String path :
        List.of(
            "/api/v1/admin/source-records",
            "/api/v1/admin/source-observations",
            "/api/v1/admin/source-observations/" + id + "/reviews",
            "/api/v1/admin/suppliers/" + id + "/verification-events",
            "/api/v1/admin/suppliers/" + id + "/external-records",
            "/api/v1/admin/facilities/" + id + "/external-records")) {
      for (var method : List.of(HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE)) {
        mvc.perform(request(method, path).header("X-Dev-Subject", principal))
            .andExpect(status().isMethodNotAllowed());
        mvc.perform(request(method, path + "/" + id).header("X-Dev-Subject", principal))
            .andExpect(status().isNotFound());
      }
    }
  }
}
