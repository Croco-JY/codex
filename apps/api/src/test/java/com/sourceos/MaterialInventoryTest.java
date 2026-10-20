package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.materialinventory.InventoryService;
import com.sourceos.shared.MeasurementUnit;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class MaterialInventoryTest extends CatalogIntegrationSupport {
  @Autowired InventoryService inventory;
  static final Instant AT = Instant.parse("2026-01-01T00:00:00Z");

  InventoryService.Input manual(UUID listing, String key, String quantity) {
    return new InventoryService.Input(
        listing,
        null,
        null,
        quantity == null ? null : new BigDecimal(quantity),
        MeasurementUnit.METER,
        InventoryService.Mode.MANUAL,
        AT,
        null,
        key);
  }

  InventoryService.Input imported(UUID listing, UUID obs) {
    return new InventoryService.Input(
        listing,
        null,
        null,
        BigDecimal.ONE,
        MeasurementUnit.METER,
        InventoryService.Mode.IMPORTED,
        AT,
        obs,
        null);
  }

  @Test
  void knownZeroIsValidUnknownAndNegativeAreRejected() {
    var l = listing(material().id());
    var zero = inventory.create(manual(l.id(), "zero", "0"));
    assertThat(zero.quantity()).isZero();
    assertThat(zero.actorSubject()).isEqualTo(principal);
    for (String value : Arrays.asList(null, "-1", "1.12345"))
      assertThatThrownBy(() -> inventory.create(manual(l.id(), id().toString(), value)))
          .isInstanceOf(RuntimeException.class);
  }

  @Test
  void captureModeChecksRequireExactlyOneIdentityAndAuthenticatedActor() {
    var l = listing(material().id());
    for (var input :
        List.of(
            imported(l.id(), null),
            manual(l.id(), null, "1"),
            manual(l.id(), " ", "1"),
            new InventoryService.Input(
                l.id(),
                null,
                null,
                BigDecimal.ONE,
                MeasurementUnit.METER,
                InventoryService.Mode.MANUAL,
                AT,
                observation,
                "both")))
      assertThatThrownBy(() -> inventory.create(input)).isInstanceOf(RuntimeException.class);
    for (String fields :
        List.of(
            "'IMPORTED',NULL,NULL,NULL,NULL",
            "'IMPORTED',NULL,'bad',NULL,NULL",
            "'MANUAL',NULL,'key',NULL,NULL",
            "'MANUAL',NULL,'key',' ','subject'",
            "'MANUAL',NULL,'key','issuer',NULL",
            "'MANUAL',NULL,' ', 'issuer','subject'"))
      assertThatThrownBy(
              () ->
                  jdbc.sql(
                          "INSERT INTO"
                              + " material_inventory_snapshot(id,listing_id,material_id,quantity,unit,observed_at,capture_mode,source_observation_id,manual_idempotency_key,actor_issuer,actor_subject)"
                              + " VALUES(gen_random_uuid(),:listing,:material,1,'METER',now(),"
                              + fields
                              + ")")
                      .param("listing", l.id())
                      .param("material", l.materialId())
                      .update())
          .hasMessageContaining("check");
  }

  @Test
  void importedNullVariantAndFacilityIdentityIsUniqueAndDifferentObservationAllowed() {
    var l = listing(material().id());
    var first = inventory.create(imported(l.id(), observation));
    assertThat(inventory.create(imported(l.id(), observation)).id()).isEqualTo(first.id());
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        "INSERT INTO material_inventory_snapshot SELECT"
                            + " gen_random_uuid(),listing_id,material_id,material_variant_id,facility_id,quantity,unit,capture_mode,observed_at,recorded_at,source_observation_id,manual_idempotency_key,actor_issuer,actor_subject,created_at"
                            + " FROM material_inventory_snapshot WHERE id=:id")
                    .param("id", first.id())
                    .update())
        .hasMessageContaining("inventory_import_identity_idx");
    var second = inventory.create(imported(l.id(), observation(record)));
    assertThat(second.id()).isNotEqualTo(first.id());
  }

  @Test
  void manualRetriesReturnExistingWithoutDuplicateAuditAndConflictingFacts409() {
    var l = listing(material().id());
    var first = inventory.create(manual(l.id(), "command", "2.0"));
    long count =
        jdbc.sql("SELECT count(*) FROM audit_event WHERE entity_id=:id")
            .param("id", first.id())
            .query(Long.class)
            .single();
    assertThat(inventory.create(manual(l.id(), "command", "2.0000")).id()).isEqualTo(first.id());
    assertThat(
            jdbc.sql("SELECT count(*) FROM audit_event WHERE entity_id=:id")
                .param("id", first.id())
                .query(Long.class)
                .single())
        .isEqualTo(count);
    assertThatThrownBy(() -> inventory.create(manual(l.id(), "command", "3")))
        .hasMessageContaining("conflict");
    assertThat(inventory.create(manual(listing(l.materialId()).id(), "command", "2")).id())
        .isNotEqualTo(first.id());
  }

  @Test
  void manualCommandCannotBeReattributedToAnotherActor() {
    var l = listing(material().id());
    var first = inventory.create(manual(l.id(), "actor-command", "1"));
    String second = admin();
    actor(second);
    try {
      assertThatThrownBy(() -> inventory.create(manual(l.id(), "actor-command", "1")))
          .hasMessageContaining("conflict");
    } finally {
      actor(principal);
    }
    assertThat(first.actorSubject()).isEqualTo(principal);
  }

  @Test
  void compositeForeignKeysProtectMaterialAndVariantButThirdPartyFacilityIsAllowed() {
    var m = material();
    var l = listing(m.id());
    var other = material();
    var v = variant(other.id());
    UUID facility = facility(catalogSupplier, JP, null, null).id();
    var input =
        new InventoryService.Input(
            l.id(),
            null,
            facility,
            BigDecimal.ONE,
            MeasurementUnit.METER,
            InventoryService.Mode.IMPORTED,
            AT,
            observation,
            null);
    var found = inventory.create(input);
    assertThat(found.facilityId()).isEqualTo(facility);
    assertThatThrownBy(
            () ->
                inventory.create(
                    new InventoryService.Input(
                        l.id(),
                        v.id(),
                        null,
                        BigDecimal.ONE,
                        MeasurementUnit.METER,
                        InventoryService.Mode.MANUAL,
                        AT,
                        null,
                        "wrong-parent")))
        .isInstanceOf(RuntimeException.class);
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        "INSERT INTO"
                            + " material_inventory_snapshot(id,listing_id,material_id,material_variant_id,quantity,unit,capture_mode,observed_at,source_observation_id)"
                            + " VALUES(gen_random_uuid(),:listing,:material,:variant,1,'METER','IMPORTED',now(),:observation)")
                    .param("listing", l.id())
                    .param("material", m.id())
                    .param("variant", v.id())
                    .param("observation", observation)
                    .update())
        .hasMessageContaining("foreign key");
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        "INSERT INTO"
                            + " material_inventory_snapshot(id,listing_id,material_id,quantity,unit,capture_mode,observed_at,source_observation_id)"
                            + " VALUES(gen_random_uuid(),:listing,:material,1,'METER','IMPORTED',now(),:observation)")
                    .param("listing", l.id())
                    .param("material", other.id())
                    .param("observation", observation)
                    .update())
        .hasMessageContaining("foreign key");
  }

  @Test
  void everySnapshotFieldIsImmutableAndDeletionAndTruncationRejected() {
    var p = inventory.create(manual(listing(material().id()).id(), "history", "1"));
    for (String sql :
        List.of(
            "UPDATE material_inventory_snapshot SET quantity=quantity WHERE id=:id",
            "UPDATE material_inventory_snapshot SET quantity=2 WHERE id=:id",
            "DELETE FROM material_inventory_snapshot WHERE id=:id",
            "TRUNCATE material_inventory_snapshot"))
      assertThatThrownBy(() -> jdbc.sql(sql).param("id", p.id()).update())
          .hasMessageContaining("append-only");
  }

  @Test
  void historyIsBoundedAndLatestIsPerLocationUnitModeAndProviderWithoutSumming() {
    var l = listing(material().id());
    var first = inventory.create(manual(l.id(), "first", "1"));
    var later =
        inventory.create(
            new InventoryService.Input(
                l.id(),
                null,
                null,
                new BigDecimal("2"),
                MeasurementUnit.METER,
                InventoryService.Mode.MANUAL,
                AT.plusSeconds(1),
                null,
                "second"));
    var imp = inventory.create(imported(l.id(), observation));
    var f = new InventoryService.Filter(l.id(), null, null, null, null, null, false);
    var page = inventory.list(f, 1, null);
    assertThat(inventory.list(f, 1, page.nextCursor()).items().getFirst().id())
        .isNotEqualTo(page.items().getFirst().id());
    var latest =
        inventory.list(
            new InventoryService.Filter(l.id(), null, null, null, null, null, true), 25, null);
    assertThat(latest.items())
        .extracting(InventoryService.View::id)
        .containsExactlyInAnyOrder(later.id(), imp.id());
    assertThat(
            inventory
                .list(
                    new InventoryService.Filter(
                        l.id(), null, null, null, InventoryService.Mode.MANUAL, AT, true),
                    25,
                    null)
                .items())
        .extracting(InventoryService.View::id)
        .containsExactly(first.id());
    assertThatThrownBy(
            () ->
                inventory.list(
                    new InventoryService.Filter(l.id(), null, null, null, null, null, true),
                    1,
                    page.nextCursor()))
        .isInstanceOf(RuntimeException.class);
  }

  @Test
  void inventoryActorSpoofRejectedAndApiRequiresPlatformAdmin() throws Exception {
    var l = listing(material().id());
    String body =
        new tools.jackson.databind.ObjectMapper().writeValueAsString(manual(l.id(), "http", "0"));
    mvc.perform(
            post("/api/v1/admin/material-inventory-snapshots")
                .contentType("application/json")
                .content(body))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/v1/admin/material-inventory-snapshots")
                .header("X-Dev-Subject", "ordinary-owner")
                .contentType("application/json")
                .content(body))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/v1/admin/material-inventory-snapshots")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(body.replaceFirst("\\{", "{\"actorIssuer\":\"spoof\",")))
        .andExpect(status().isBadRequest());
    mvc.perform(
            post("/api/v1/admin/material-inventory-snapshots")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.actorSubject").value(principal));
  }

  @Test
  void auditFailureRollsBackSnapshot() {
    var l = listing(material().id());
    jdbc.sql(
            "CREATE FUNCTION reject_test_inventory_audit() RETURNS trigger LANGUAGE plpgsql AS $$"
                + " BEGIN IF NEW.action='material.inventory.recorded' THEN RAISE EXCEPTION"
                + " 'Synthetic inventory audit failure'; END IF; RETURN NEW; END; $$")
        .update();
    jdbc.sql(
            "CREATE TRIGGER reject_test_inventory_audit BEFORE INSERT ON audit_event FOR EACH ROW"
                + " EXECUTE FUNCTION reject_test_inventory_audit()")
        .update();
    try {
      assertThatThrownBy(() -> inventory.create(manual(l.id(), "rollback", "1")))
          .isInstanceOf(RuntimeException.class);
      assertThat(
              jdbc.sql("SELECT count(*) FROM material_inventory_snapshot WHERE listing_id=:id")
                  .param("id", l.id())
                  .query(Long.class)
                  .single())
          .isZero();
    } finally {
      jdbc.sql("DROP TRIGGER reject_test_inventory_audit ON audit_event").update();
      jdbc.sql("DROP FUNCTION reject_test_inventory_audit()").update();
    }
  }
}
