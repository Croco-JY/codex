package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.dataingestion.SourceService;
import com.sourceos.material.MaterialService;
import com.sourceos.materiallisting.ListingService;
import com.sourceos.shared.MeasurementUnit;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

class MaterialCatalogTest extends CatalogIntegrationSupport {
  @Test
  void catalogIdentityHasIndependentOriginAndDraftLifecycle() {
    var m =
        materials.create(
            materialInput(
                catalogSupplier, MaterialService.Type.FABRIC, MaterialService.Status.DRAFT, 0));
    assertThat(m.status()).isEqualTo(MaterialService.Status.DRAFT);
    assertThat(m.catalogSupplierId()).isEqualTo(catalogSupplier);
    assertThat(m.originCountryId()).isNull();
    assertThat(m.composition()).isEmpty();
    assertThat(materials.variants(m.id(), 25, 0)).isEmpty();
    assertThat(listings.list(m.id(), null, 25, 0)).isEmpty();
  }

  @Test
  void similarArticlesAreNeverAutomaticallyMerged() {
    var input =
        materialInput(
            catalogSupplier, MaterialService.Type.FABRIC, MaterialService.Status.ACTIVE, 0);
    assertThat(materials.create(input).id()).isNotEqualTo(materials.create(input).id());
  }

  @Test
  void materialUpdatesArchiveAndRejectStaleVersions() {
    var m = material();
    var u =
        materials.update(
            m.id(),
            materialInput(
                catalogSupplier, MaterialService.Type.FABRIC, MaterialService.Status.ARCHIVED, 0));
    assertThat(u.version()).isEqualTo(1);
    assertThat(u.status()).isEqualTo(MaterialService.Status.ARCHIVED);
    assertThatThrownBy(
            () ->
                materials.update(
                    m.id(),
                    materialInput(
                        catalogSupplier,
                        MaterialService.Type.FABRIC,
                        MaterialService.Status.ACTIVE,
                        0)))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
  }

  @Test
  void materialSupplierTypeAndCreationIdentityAreDbImmutable() {
    var m = material();
    assertThatThrownBy(
            () ->
                materials.update(
                    m.id(),
                    materialInput(
                        seller, MaterialService.Type.FABRIC, MaterialService.Status.ACTIVE, 0)))
        .hasMessageContaining("identity");
    for (String change :
        List.of(
            "catalog_supplier_id='" + seller + "'",
            "material_type='LEATHER'",
            "created_at=created_at+interval '1 second'",
            "id=gen_random_uuid()")) {
      assertThatThrownBy(
              () ->
                  jdbc.sql("UPDATE material SET " + change + " WHERE id=:id")
                      .param("id", m.id())
                      .update())
          .hasMessageContaining("identity is immutable");
    }
  }

  @Test
  void variantUpdatesAndParentAreProtected() {
    var a = material();
    var b = material();
    var v = variant(a.id());
    assertThat(materials.updateVariant(v.id(), variantInput(a.id(), 0)).version()).isEqualTo(1);
    assertThatThrownBy(() -> materials.updateVariant(v.id(), variantInput(a.id(), 0)))
        .hasMessageContaining("conflict");
    assertThatThrownBy(
            () ->
                jdbc.sql("UPDATE material_variant SET material_id=:other WHERE id=:id")
                    .param("other", b.id())
                    .param("id", v.id())
                    .update())
        .hasMessageContaining("identity is immutable");
  }

  @Test
  void sameSellerMaterialCanHaveMultipleActiveServerGeneratedListings() {
    var m = material();
    var input =
        listingInput(
            m.id(),
            new BigDecimal("50"),
            null,
            MeasurementUnit.METER,
            ListingService.Status.ACTIVE,
            0);
    var a = listings.create(input);
    var b = listings.create(input);
    assertThat(a.id()).isNotEqualTo(b.id());
    assertThat(listings.list(m.id(), seller, 25, 0)).hasSize(2);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM information_schema.columns WHERE"
                        + " table_name='supplier_material_listing' AND column_name IN"
                        + " ('creation_request_hash','active')")
                .query(Integer.class)
                .single())
        .isZero();
  }

  @Test
  void listingTermsMutableButSellerMaterialIdentityImmutable() {
    var m = material();
    var l = listing(m.id());
    var u =
        listings.update(
            l.id(),
            listingInput(
                m.id(),
                new BigDecimal("25.5000"),
                new BigDecimal("5"),
                MeasurementUnit.METER,
                ListingService.Status.ARCHIVED,
                0));
    assertThat(u.minimumOrderQuantity()).isEqualByComparingTo("25.5");
    assertThat(u.status()).isEqualTo(ListingService.Status.ARCHIVED);
    assertThatThrownBy(
            () ->
                listings.update(
                    l.id(),
                    listingInput(m.id(), null, null, null, ListingService.Status.ACTIVE, 0)))
        .hasMessageContaining("conflict");
    for (String change :
        List.of(
            "material_id='" + material().id() + "'",
            "seller_supplier_id='" + catalogSupplier + "'")) {
      assertThatThrownBy(
              () ->
                  jdbc.sql("UPDATE supplier_material_listing SET " + change + " WHERE id=:id")
                      .param("id", l.id())
                      .update())
          .hasMessageContaining("identity is immutable");
    }
  }

  @Test
  void listingUnknownsRemainNullAndExactQuantitiesCannotBeRounded() {
    var l = listing(material().id());
    assertThat(l.minimumOrderQuantity()).isNull();
    assertThat(l.minimumColorQuantity()).isNull();
    assertThat(l.quantityUnit()).isNull();
    assertThatThrownBy(
            () ->
                listings.create(
                    listingInput(
                        l.materialId(),
                        new BigDecimal("1.00001"),
                        null,
                        MeasurementUnit.METER,
                        ListingService.Status.ACTIVE,
                        0)))
        .hasMessageContaining("decimal");
    assertThatThrownBy(
            () ->
                listings.create(
                    listingInput(
                        l.materialId(),
                        BigDecimal.ONE,
                        null,
                        null,
                        ListingService.Status.ACTIVE,
                        0)))
        .hasMessageContaining("unit");
    for (MeasurementUnit unit : MeasurementUnit.values()) {
      var x =
          listings.create(
              listingInput(
                  l.materialId(), BigDecimal.ZERO, null, unit, ListingService.Status.ACTIVE, 0));
      assertThat(x.quantityUnit()).isEqualTo(unit);
    }
  }

  @Test
  void subtypesRejectCrossTypeThroughRealCompositeForeignKeys() {
    var f = material(MaterialService.Type.FABRIC);
    var l = material(MaterialService.Type.LEATHER);
    jdbc.sql("INSERT INTO fabric_spec(material_id,gsm,width_mm) VALUES(:id,500,1500)")
        .param("id", f.id())
        .update();
    jdbc.sql(
            "INSERT INTO leather_spec(material_id,thickness_min_mm,thickness_max_mm)"
                + " VALUES(:id,1,2)")
        .param("id", l.id())
        .update();
    assertThatThrownBy(
            () ->
                jdbc.sql("INSERT INTO leather_spec(material_id) VALUES(:id)")
                    .param("id", f.id())
                    .update())
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                jdbc.sql("INSERT INTO fabric_spec(material_id) VALUES(:id)")
                    .param("id", l.id())
                    .update())
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThat(materials.fabric(f.id()).gsm()).isEqualByComparingTo("500");
    assertThat(materials.leather(l.id()).thicknessMaxMm()).isEqualByComparingTo("2");
  }

  @Test
  void physicalSpecApiIsVersionedAndExcludesCommercialPayloads() throws Exception {
    var m = material();
    String body =
        "{\"gsm\":500,\"widthMm\":1500,\"observationId\":\"" + observation + "\",\"version\":0}";
    mvc.perform(
            put("/api/v1/admin/materials/" + m.id() + "/fabric-spec")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.materialType").value("FABRIC"));
    mvc.perform(
            put("/api/v1/admin/materials/" + m.id() + "/fabric-spec")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(body.replace("\"gsm\":500", "\"gsm\":501")))
        .andExpect(status().isOk());
    mvc.perform(
            put("/api/v1/admin/materials/" + m.id() + "/fabric-spec")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(body))
        .andExpect(status().isConflict());
    mvc.perform(
            put("/api/v1/admin/materials/" + m.id() + "/fabric-spec")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(body.replace("\"gsm\":500", "\"minimumOrderQuantity\":1")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void conservativeFiberReferencesAndCodeIdentity() {
    assertThat(materials.fibers(100, 0))
        .extracting(MaterialService.Fiber::code)
        .contains(
            "WOOL",
            "CASHMERE",
            "COTTON",
            "LINEN",
            "SILK",
            "POLYESTER",
            "NYLON",
            "ACRYLIC",
            "RAYON",
            "VISCOSE",
            "LYOCELL",
            "ELASTANE",
            "OTHER");
    assertThatThrownBy(
            () -> jdbc.sql("UPDATE fiber_type SET code='RENAMED' WHERE code='WOOL'").update())
        .hasMessageContaining("identity is immutable");
  }

  @Test
  void serviceCompositionValidatesPositiveExactTotalsAndVersion() {
    var m = material();
    for (String n : List.of("0", "-1", "101", "0.00001")) {
      assertThatThrownBy(
              () ->
                  materials.composition(
                      m.id(),
                      new MaterialService.CompositionInput(
                          MaterialService.Completeness.PARTIAL,
                          List.of(new MaterialService.Part(fiber("WOOL"), new BigDecimal(n))),
                          observation,
                          0)))
          .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
    var complete =
        materials.composition(
            m.id(),
            new MaterialService.CompositionInput(
                MaterialService.Completeness.COMPLETE,
                List.of(
                    new MaterialService.Part(fiber("WOOL"), new BigDecimal("80")),
                    new MaterialService.Part(fiber("CASHMERE"), new BigDecimal("20"))),
                observation,
                0));
    assertThat(complete.composition()).hasSize(2);
    assertThatThrownBy(
            () ->
                materials.composition(
                    m.id(),
                    new MaterialService.CompositionInput(
                        MaterialService.Completeness.UNKNOWN, List.of(), observation, 0)))
        .hasMessageContaining("conflict");
  }

  private void directComposition(
      UUID id, String mode, List<MaterialService.Part> parts, AtomicBoolean callbackCompleted) {
    tx().executeWithoutResult(
            t -> {
              jdbc.sql("UPDATE material SET composition_completeness=:mode WHERE id=:id")
                  .param("mode", mode)
                  .param("id", id)
                  .update();
              jdbc.sql("DELETE FROM material_composition WHERE material_id=:id")
                  .param("id", id)
                  .update();
              for (var p : parts)
                jdbc.sql(
                        "INSERT INTO material_composition(material_id,fiber_type_id,percentage)"
                            + " VALUES(:id,:fiber,:percentage)")
                    .param("id", id)
                    .param("fiber", p.fiberTypeId())
                    .param("percentage", p.percentage())
                    .update();
              callbackCompleted.set(true);
            });
  }

  @Test
  void deferredCompositionRejectsInvalidFinalStatesAtCommit() {
    var m = material();
    var wool80 = new MaterialService.Part(fiber("WOOL"), new BigDecimal("80"));
    var cotton40 = new MaterialService.Part(fiber("COTTON"), new BigDecimal("40"));
    for (var scenario :
        List.of(
            Map.entry("UNKNOWN", List.of(wool80)),
            Map.entry("PARTIAL", List.<MaterialService.Part>of()),
            Map.entry("COMPLETE", List.of(wool80)),
            Map.entry("COMPLETE", List.of(wool80, cotton40)),
            Map.entry("PARTIAL", List.of(wool80, cotton40)))) {
      var reached = new AtomicBoolean();
      assertThatThrownBy(
              () -> directComposition(m.id(), scenario.getKey(), scenario.getValue(), reached))
          .hasStackTraceContaining("composition completeness mismatch");
      assertThat(reached).isTrue();
      assertThat(materials.read(m.id()).compositionCompleteness())
          .isEqualTo(MaterialService.Completeness.UNKNOWN);
      assertThat(materials.parts(m.id())).isEmpty();
    }
  }

  @Test
  void directCompositionAllowsAtomicReplaceAndChecksParentCompletenessChanges() {
    var m = material();
    directComposition(
        m.id(),
        "PARTIAL",
        List.of(new MaterialService.Part(fiber("WOOL"), new BigDecimal("80"))),
        new AtomicBoolean());
    directComposition(
        m.id(),
        "COMPLETE",
        List.of(new MaterialService.Part(fiber("COTTON"), new BigDecimal("100"))),
        new AtomicBoolean());
    assertThatThrownBy(
            () ->
                tx().executeWithoutResult(
                        t ->
                            jdbc.sql(
                                    "UPDATE material SET composition_completeness='UNKNOWN' WHERE"
                                        + " id=:id")
                                .param("id", m.id())
                                .update()))
        .hasStackTraceContaining("composition completeness mismatch");
    directComposition(m.id(), "UNKNOWN", List.of(), new AtomicBoolean());
    assertThat(materials.parts(m.id())).isEmpty();
  }

  @Test
  void directZeroNegativeAndOverHundredComponentsFailDatabaseChecks() {
    var m = material();
    for (String n : List.of("0", "-1", "101"))
      assertThatThrownBy(
              () ->
                  jdbc.sql(
                          "INSERT INTO material_composition(material_id,fiber_type_id,percentage)"
                              + " VALUES(:id,:fiber,:n)")
                      .param("id", m.id())
                      .param("fiber", fiber("WOOL"))
                      .param("n", new BigDecimal(n))
                      .update())
          .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void concurrentDirectCompositionWritersCannotOvershootTotal() throws Exception {
    var m = material();
    directComposition(
        m.id(),
        "PARTIAL",
        List.of(new MaterialService.Part(fiber("WOOL"), new BigDecimal("40"))),
        new AtomicBoolean());
    var start = new CountDownLatch(1);
    try (var pool = Executors.newFixedThreadPool(2)) {
      List<Future<Boolean>> results = new ArrayList<>();
      for (UUID f : List.of(fiber("COTTON"), fiber("CASHMERE"))) {
        results.add(
            pool.submit(
                () -> {
                  start.await();
                  try {
                    tx().executeWithoutResult(
                            t ->
                                jdbc.sql(
                                        "INSERT INTO"
                                            + " material_composition(material_id,fiber_type_id,percentage)"
                                            + " VALUES(:m,:f,40)")
                                    .param("m", m.id())
                                    .param("f", f)
                                    .update());
                    return true;
                  } catch (RuntimeException e) {
                    assertThat(e).hasStackTraceContaining("composition completeness mismatch");
                    return false;
                  }
                }));
      }
      start.countDown();
      assertThat(
              List.of(
                  results.get(0).get(15, TimeUnit.SECONDS),
                  results.get(1).get(15, TimeUnit.SECONDS)))
          .containsExactlyInAnyOrder(true, false);
    }
    assertThat(
            jdbc.sql("SELECT sum(percentage) FROM material_composition WHERE material_id=:id")
                .param("id", m.id())
                .query(BigDecimal.class)
                .single())
        .isEqualByComparingTo("80");
  }

  @Test
  void typedBindingsAndProvenanceUseDifferentForeignKeys() {
    var m = material();
    var v = variant(m.id());
    var l = listing(m.id());
    for (var item :
        List.of(
            new Object[] {
              "material_external_record", "material_id", m.id(), SourceService.RecordKind.MATERIAL
            },
            new Object[] {
              "material_variant_external_record",
              "material_variant_id",
              v.id(),
              SourceService.RecordKind.MATERIAL_VARIANT
            },
            new Object[] {
              "supplier_material_listing_external_record",
              "listing_id",
              l.id(),
              SourceService.RecordKind.MATERIAL_LISTING
            })) {
      String table = (String) item[0], key = (String) item[1];
      UUID target = (UUID) item[2];
      assertThatThrownBy(
              () ->
                  jdbc.sql(
                          "INSERT INTO "
                              + table
                              + "(source_record_id,"
                              + key
                              + ") VALUES(:record,:id)")
                      .param("record", record)
                      .param("id", target)
                      .update())
          .isInstanceOf(DataIntegrityViolationException.class);
      UUID external = external((SourceService.RecordKind) item[3], table);
      jdbc.sql("INSERT INTO " + table + "(source_record_id," + key + ") VALUES(:record,:id)")
          .param("record", external)
          .param("id", target)
          .update();
      for (String sql :
          List.of(
              "UPDATE " + table + " SET created_at=created_at",
              "DELETE FROM " + table,
              "TRUNCATE " + table))
        assertThatThrownBy(() -> jdbc.sql(sql).update()).hasMessageContaining("append-only");
    }
    assertThatThrownBy(
            () ->
                materials.cite(
                    m.id(), new MaterialService.Citation(record, MaterialService.Fact.RECORD)))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThat(materials.citations(m.id(), false, 25, 0)).hasSize(1);
  }

  @Test
  void importedListingAndMaterialIdentitiesReuseCanonicalRows() {
    UUID r = external(SourceService.RecordKind.MATERIAL, "catalog-id"), obs = observation(r);
    var input =
        new MaterialService.Input(
            catalogSupplier,
            "original",
            MaterialService.Type.FABRIC,
            "Synthetic import",
            null,
            null,
            MaterialService.Completeness.UNKNOWN,
            List.of(),
            MaterialService.Status.ACTIVE,
            obs,
            0);
    var m = materials.resolve(new MaterialService.IdentityInput(r, input));
    assertThat(materials.resolve(new MaterialService.IdentityInput(r, input)).id())
        .isEqualTo(m.id());
    assertThatThrownBy(() -> materials.bind(material().id(), r, false))
        .hasMessageContaining("conflict");
    UUID offer = external(SourceService.RecordKind.MATERIAL_LISTING, "offering");
    UUID offerObs = observation(offer);
    var listingInput =
        new ListingService.Input(
            m.id(),
            seller,
            "offer",
            null,
            null,
            null,
            null,
            null,
            ListingService.Status.ACTIVE,
            offerObs,
            0);
    var cmd = new ListingService.IdentityInput(offer, listingInput);
    assertThat(listings.resolve(cmd).id()).isEqualTo(listings.resolve(cmd).id());
  }

  @Test
  void materialAuditFailureRollsBackCanonicalFactsAndEvidence() {
    long before = jdbc.sql("SELECT count(*) FROM material").query(Long.class).single();
    jdbc.sql(
            "CREATE FUNCTION reject_test_material_audit() RETURNS trigger LANGUAGE plpgsql AS $$"
                + " BEGIN IF NEW.action='material.created' THEN RAISE EXCEPTION 'Synthetic material"
                + " audit failure'; END IF; RETURN NEW; END; $$")
        .update();
    jdbc.sql(
            "CREATE TRIGGER test_material_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE"
                + " FUNCTION reject_test_material_audit()")
        .update();
    try {
      assertThatThrownBy(this::material)
          .hasStackTraceContaining("Synthetic material audit failure");
      assertThat(jdbc.sql("SELECT count(*) FROM material").query(Long.class).single())
          .isEqualTo(before);
    } finally {
      jdbc.sql("DROP TRIGGER test_material_audit ON audit_event").update();
      jdbc.sql("DROP FUNCTION reject_test_material_audit()").update();
    }
  }

  @Test
  void platformAuthorizationRejectsLinkedOwnersAndActorSpoofing() throws Exception {
    UUID org = id();
    jdbc.sql("INSERT INTO organization(id,name) VALUES(:id,'Synthetic linked account')")
        .param("id", org)
        .update();
    jdbc.sql(
            "INSERT INTO membership(id,organization_id,issuer,subject,role)"
                + " VALUES(:id,:org,'urn:source-os:local','catalog-linked-owner','ORG_OWNER')")
        .param("id", id())
        .param("org", org)
        .update();
    jdbc.sql(
            "INSERT INTO"
                + " supplier_organization_link(id,supplier_profile_id,organization_id,status,linked_by_issuer,linked_by_subject)"
                + " VALUES(:id,:supplier,:org,'ACTIVE','urn:source-os:local','fixture')")
        .param("id", id())
        .param("supplier", catalogSupplier)
        .param("org", org)
        .update();
    String body =
        new tools.jackson.databind.ObjectMapper()
            .writeValueAsString(
                materialInput(
                    catalogSupplier,
                    MaterialService.Type.FABRIC,
                    MaterialService.Status.ACTIVE,
                    0));
    mvc.perform(post("/api/v1/admin/materials").contentType("application/json").content(body))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/v1/admin/materials")
                .header("X-Dev-Subject", "catalog-linked-owner")
                .contentType("application/json")
                .content(body))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/v1/admin/materials")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(body))
        .andExpect(status().isOk());
    mvc.perform(
            post("/api/v1/admin/materials")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(body.replaceFirst("\\{", "{\"actorIssuer\":\"spoof\",")))
        .andExpect(status().isBadRequest());
  }
}
