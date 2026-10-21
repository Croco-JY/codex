package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.dataingestion.SourceService;
import com.sourceos.material.MaterialService;
import com.sourceos.materialinventory.InventoryService;
import com.sourceos.materiallisting.ListingService;
import com.sourceos.materialprice.PriceService;
import com.sourceos.shared.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

class PhaseOneBContractTest extends CatalogIntegrationSupport {
  @Autowired PriceService prices;
  @Autowired InventoryService inventory;

  @Autowired
  @org.springframework.beans.factory.annotation.Qualifier("requestMappingHandlerMapping")
  org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping mappings;

  static final Instant AT = Instant.parse("2026-01-01T00:00:00Z");

  PriceService.Input price(UUID l, UUID provider) {
    return new PriceService.Input(
        l,
        null,
        provider,
        BigDecimal.ONE,
        "USD",
        MeasurementUnit.METER,
        null,
        AT.minusSeconds(10),
        null,
        AT.minusSeconds(5),
        List.of(
            provider.equals(source)
                ? observation
                : observation(
                    sources
                        .record(
                            new SourceService.RecordInput(
                                provider, SourceService.RecordKind.SUPPLIER, "price-evidence"))
                        .id())));
  }

  @Test
  void eachMutationRejectsUnauthenticatedAndLinkedOrgOwner() throws Exception {
    UUID org = id();
    String owner = "linked-owner-" + id();
    jdbc.sql("INSERT INTO organization(id,name) VALUES(:id,'Synthetic linked catalog owner')")
        .param("id", org)
        .update();
    jdbc.sql(
            "INSERT INTO membership(id,organization_id,issuer,subject,role)"
                + " VALUES(:id,:org,'urn:source-os:local',:owner,'ORG_OWNER')")
        .param("id", id())
        .param("org", org)
        .param("owner", owner)
        .update();
    jdbc.sql(
            "INSERT INTO"
                + " supplier_organization_link(id,supplier_profile_id,organization_id,status,linked_by_issuer,linked_by_subject)"
                + " VALUES(:id,:supplier,:org,'ACTIVE','fixture','operator')")
        .param("id", id())
        .param("supplier", catalogSupplier)
        .param("org", org)
        .update();
    var m = material();
    var v = variant(m.id());
    var l = listing(m.id());
    var p = prices.create(price(l.id(), source), null);
    record Command(MockHttpServletRequestBuilder request, Object body) {}
    var commands =
        List.of(
            new Command(
                post("/api/v1/admin/materials"),
                materialInput(
                    catalogSupplier,
                    MaterialService.Type.FABRIC,
                    MaterialService.Status.ACTIVE,
                    0)),
            new Command(
                put("/api/v1/admin/materials/" + m.id()),
                materialInput(
                    catalogSupplier,
                    MaterialService.Type.FABRIC,
                    MaterialService.Status.ACTIVE,
                    0)),
            new Command(
                post("/api/v1/admin/materials/" + m.id() + "/variants"), variantInput(m.id(), 0)),
            new Command(put("/api/v1/admin/material-variants/" + v.id()), variantInput(m.id(), 0)),
            new Command(
                put("/api/v1/admin/materials/" + m.id() + "/composition"),
                new MaterialService.CompositionInput(
                    MaterialService.Completeness.UNKNOWN, List.of(), observation, 0)),
            new Command(
                put("/api/v1/admin/materials/" + m.id() + "/fabric-spec")
                    .header("If-None-Match", "*"),
                Map.of("observationId", observation, "version", 0)),
            new Command(
                put("/api/v1/admin/materials/" + m.id() + "/leather-spec")
                    .header("If-None-Match", "*"),
                Map.of("observationId", observation, "version", 0)),
            new Command(
                post("/api/v1/admin/fiber-types"),
                Map.of(
                    "code",
                    "SYNTHETIC",
                    "nameEn",
                    "Synthetic fiber",
                    "active",
                    true,
                    "version",
                    0)),
            new Command(
                post("/api/v1/admin/material-listings"),
                listingInput(m.id(), null, null, null, ListingService.Status.ACTIVE, 0)),
            new Command(
                put("/api/v1/admin/material-listings/" + l.id()),
                listingInput(m.id(), null, null, null, ListingService.Status.ACTIVE, 0)),
            new Command(post("/api/v1/admin/material-prices"), price(l.id(), source)),
            new Command(
                post("/api/v1/admin/material-prices/" + p.id() + "/close"),
                new PriceService.CloseInput(AT, 0)),
            new Command(
                post("/api/v1/admin/material-prices/" + p.id() + "/sources"),
                new PriceService.Evidence(observation)),
            new Command(
                post("/api/v1/admin/material-inventory-snapshots"),
                new InventoryService.Input(
                    l.id(),
                    null,
                    null,
                    BigDecimal.ZERO,
                    MeasurementUnit.METER,
                    InventoryService.Mode.MANUAL,
                    AT,
                    null,
                    "synthetic-manual")),
            new Command(
                post("/api/v1/admin/materials/" + m.id() + "/external-records"),
                Map.of("sourceRecordId", record)),
            new Command(
                post("/api/v1/admin/material-variants/" + v.id() + "/external-records"),
                Map.of("sourceRecordId", record)),
            new Command(
                post("/api/v1/admin/material-listings/" + l.id() + "/external-records"),
                Map.of("sourceRecordId", record)),
            new Command(
                post("/api/v1/admin/materials/" + m.id() + "/sources"),
                new MaterialService.Citation(observation, MaterialService.Fact.RECORD)),
            new Command(
                post("/api/v1/admin/material-variants/" + v.id() + "/sources"),
                new MaterialService.VariantCitation(
                    observation, MaterialService.VariantFact.RECORD)),
            new Command(
                post("/api/v1/admin/material-listings/" + l.id() + "/sources"),
                new ListingService.Citation(observation, ListingService.Fact.RECORD)));
    var mapper = new tools.jackson.databind.ObjectMapper();
    for (var c : commands) {
      String body = mapper.writeValueAsString(c.body());
      mvc.perform(c.request().contentType("application/json").content(body))
          .andExpect(status().isUnauthorized());
      mvc.perform(
              c.request()
                  .header("X-Dev-Subject", owner)
                  .contentType("application/json")
                  .content(body))
          .andExpect(status().isForbidden());
    }
    mvc.perform(
            post("/api/v1/admin/material-prices")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(mapper.writeValueAsString(price(l.id(), source))))
        .andExpect(status().isOk());
    mvc.perform(
            post("/api/v1/admin/material-prices/" + p.id() + "/close")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(mapper.writeValueAsString(new PriceService.CloseInput(AT, 0))))
        .andExpect(status().isOk());
  }

  @Test
  void openApiModelsDoNotConflateCatalogListingPriceAndInventory() throws Exception {
    mvc.perform(get("/v3/api-docs"))
        .andExpect(status().isOk())
        .andExpect(
            jsonPath("$.components.schemas.MaterialInput.properties.catalogSupplierId").exists())
        .andExpect(
            jsonPath("$.components.schemas.ListingInput.properties.sellerSupplierId").exists())
        .andExpect(jsonPath("$.components.schemas.PriceInput.properties.amount").exists())
        .andExpect(jsonPath("$.components.schemas.InventoryInput.properties.captureMode").exists())
        .andExpect(
            jsonPath("$.components.schemas.PriceResolution.properties.listingTermsScope").exists());
  }

  @Test
  void independentProvidersAndCreatedIdTieBreakers() {
    var l = listing(material().id());
    UUID other =
        sources.source(
            null,
            new SourceService.SourceInput(
                "provider-" + id(),
                SourceService.SourceType.MANUAL_ENTRY,
                "Synthetic independent provider",
                null,
                null,
                SourceService.AccessMethod.MANUAL,
                SourceService.Normalization.PRESERVE,
                true,
                0));
    prices.create(price(l.id(), source), null);
    prices.create(price(l.id(), other), null);
    var request =
        new PriceService.MatchRequest(null, null, "USD", MeasurementUnit.METER, AT, false, null);
    assertThat(prices.resolve(l.id(), request, 25, null).scopes())
        .extracting(PriceService.Outcome::dataSourceId)
        .containsExactlyInAnyOrder(source, other);
    var tied = listing(l.materialId());
    UUID low = UUID.fromString("00000000-0000-4000-8000-000000000100"),
        high = UUID.fromString("00000000-0000-4000-8000-000000000101");
    for (UUID key : List.of(low, high))
      jdbc.sql(
              "INSERT INTO"
                  + " material_price(id,listing_id,material_id,data_source_id,amount,currency,price_unit,valid_from,observed_at,created_at)"
                  + " VALUES(:id,:listing,:material,:source,10,'USD','METER',:at,:at,:at)")
          .param("id", key)
          .param("listing", tied.id())
          .param("material", tied.materialId())
          .param("source", source)
          .param("at", Keysets.time(AT.minusSeconds(10)))
          .update();
    assertThat(prices.resolve(tied.id(), request, 25, null).scopes().getFirst().price().id())
        .isEqualTo(high);
    UUID newer = id();
    jdbc.sql(
            "INSERT INTO"
                + " material_price(id,listing_id,material_id,data_source_id,amount,currency,price_unit,valid_from,observed_at,created_at)"
                + " SELECT"
                + " :new,listing_id,material_id,data_source_id,amount,currency,price_unit,valid_from,observed_at,created_at+interval"
                + " '1 second' FROM material_price WHERE id=:old")
        .param("new", newer)
        .param("old", low)
        .update();
    assertThat(prices.resolve(tied.id(), request, 25, null).scopes().getFirst().price().id())
        .isEqualTo(newer);
  }

  @Test
  void concurrentImportedIdentityAndInventoryRetriesHaveOneCanonicalFact() throws Exception {
    UUID external = external(SourceService.RecordKind.MATERIAL, "concurrent-catalog"),
        obs = observation(external);
    var input =
        new MaterialService.Input(
            catalogSupplier,
            "import",
            MaterialService.Type.FABRIC,
            "Synthetic concurrent article",
            null,
            null,
            MaterialService.Completeness.UNKNOWN,
            List.of(),
            MaterialService.Status.ACTIVE,
            obs,
            0);
    try (var pool = Executors.newFixedThreadPool(2)) {
      var start = new CountDownLatch(1);
      List<Future<UUID>> futures = new ArrayList<>();
      for (int i = 0; i < 2; i++)
        futures.add(
            pool.submit(
                () -> {
                  actor(principal);
                  start.await();
                  try {
                    return materials
                        .resolve(new MaterialService.IdentityInput(external, input))
                        .id();
                  } finally {
                    org.springframework.security.core.context.SecurityContextHolder.clearContext();
                  }
                }));
      start.countDown();
      assertThat(futures.get(0).get(15, TimeUnit.SECONDS))
          .isEqualTo(futures.get(1).get(15, TimeUnit.SECONDS));
    }
    var l = listing(material().id());
    var stock =
        new InventoryService.Input(
            l.id(),
            null,
            null,
            BigDecimal.ONE,
            MeasurementUnit.METER,
            InventoryService.Mode.IMPORTED,
            AT,
            observation,
            null);
    try (var pool = Executors.newFixedThreadPool(2)) {
      var start = new CountDownLatch(1);
      List<Future<UUID>> futures = new ArrayList<>();
      for (int i = 0; i < 2; i++)
        futures.add(
            pool.submit(
                () -> {
                  actor(principal);
                  start.await();
                  try {
                    return inventory.create(stock).id();
                  } finally {
                    org.springframework.security.core.context.SecurityContextHolder.clearContext();
                  }
                }));
      start.countDown();
      assertThat(futures.get(0).get(15, TimeUnit.SECONDS))
          .isEqualTo(futures.get(1).get(15, TimeUnit.SECONDS));
    }
  }

  @Test
  void priceClosureAuditFailureRollsBackVersionAndInterval() {
    var p = prices.create(price(listing(material().id()).id(), source), null);
    jdbc.sql(
            "CREATE FUNCTION reject_test_close_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
                + " IF NEW.action='material.price.closed' THEN RAISE EXCEPTION 'Synthetic closure"
                + " audit failure'; END IF; RETURN NEW; END; $$")
        .update();
    jdbc.sql(
            "CREATE TRIGGER reject_test_close_audit BEFORE INSERT ON audit_event FOR EACH ROW"
                + " EXECUTE FUNCTION reject_test_close_audit()")
        .update();
    try {
      assertThatThrownBy(() -> prices.close(p.id(), new PriceService.CloseInput(AT, 0)))
          .isInstanceOf(RuntimeException.class);
      assertThat(prices.read(p.id()).validTo()).isNull();
      assertThat(prices.read(p.id()).version()).isZero();
    } finally {
      jdbc.sql("DROP TRIGGER reject_test_close_audit ON audit_event").update();
      jdbc.sql("DROP FUNCTION reject_test_close_audit()").update();
    }
  }

  @Test
  void phaseOneBHasNoDestructiveBusinessRoutesOrNonScalarAuditState() {
    var m = material();
    var l = listing(m.id());
    prices.create(price(l.id(), source), null);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM audit_event a CROSS JOIN LATERAL"
                        + " jsonb_each(coalesce(a.after_state,'{}'::jsonb)) e WHERE a.action LIKE"
                        + " 'material.%' AND jsonb_typeof(e.value) IN ('object','array')")
                .query(Long.class)
                .single())
        .isZero();
    var destructive =
        mappings.getHandlerMethods().entrySet().stream()
            .filter(
                e ->
                    e.getValue()
                        .getBeanType()
                        .getPackageName()
                        .matches("com\\.sourceos\\.material(price|inventory)"))
            .flatMap(e -> e.getKey().getMethodsCondition().getMethods().stream())
            .toList();
    assertThat(destructive)
        .doesNotContain(
            org.springframework.web.bind.annotation.RequestMethod.PUT,
            org.springframework.web.bind.annotation.RequestMethod.PATCH,
            org.springframework.web.bind.annotation.RequestMethod.DELETE);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM information_schema.columns WHERE"
                        + " table_name='material_inventory_snapshot' AND column_name IN"
                        + " ('version','updated_at')")
                .query(Long.class)
                .single())
        .isZero();
  }
}
