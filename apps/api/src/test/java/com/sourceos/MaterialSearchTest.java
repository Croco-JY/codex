package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.material.MaterialService;
import com.sourceos.materiallisting.ListingService;
import com.sourceos.materialprice.PriceService;
import com.sourceos.materialsearch.MaterialSearch;
import com.sourceos.shared.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class MaterialSearchTest extends CatalogIntegrationSupport {
  @Autowired MaterialSearch catalog;
  @Autowired PriceService prices;
  static final Instant AT = Instant.parse("2026-01-01T00:00:00Z");

  MaterialSearch.Filters filter(Object... pairs) {
    Map<String, Object> map = new HashMap<>();
    map.put("catalogSupplierId", catalogSupplier);
    for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
    return new tools.jackson.databind.ObjectMapper()
        .convertValue(map, MaterialSearch.Filters.class);
  }

  List<UUID> ids(Object... pairs) {
    return catalog.search(filter(pairs), 25, null).items().stream()
        .map(MaterialService.View::id)
        .toList();
  }

  ListingService.View offer(
      UUID material, UUID seller, String moq, String mcq, MeasurementUnit unit, Integer lead) {
    return listings.create(
        new ListingService.Input(
            material,
            seller,
            "offer",
            moq == null ? null : new BigDecimal(moq),
            mcq == null ? null : new BigDecimal(mcq),
            unit,
            lead,
            null,
            ListingService.Status.ACTIVE,
            observation,
            0));
  }

  PriceService.View price(
      UUID listing,
      UUID variant,
      String amount,
      String moq,
      String currency,
      MeasurementUnit unit) {
    return prices.create(
        new PriceService.Input(
            listing,
            variant,
            source,
            new BigDecimal(amount),
            currency,
            unit,
            moq == null ? null : new BigDecimal(moq),
            AT.minusSeconds(10),
            null,
            AT.minusSeconds(5),
            List.of(observation)),
        null);
  }

  Map<String, Object> scope(String max) {
    Map<String, Object> m = new HashMap<>();
    m.put("maxPrice", new BigDecimal(max));
    m.put("priceDataSourceId", source);
    m.put("currency", "USD");
    m.put("priceUnit", MeasurementUnit.METER);
    m.put("asOf", AT);
    return m;
  }

  MaterialSearch.Filters priced(String max, Object... extra) {
    var map = scope(max);
    map.put("catalogSupplierId", catalogSupplier);
    for (int i = 0; i < extra.length; i += 2) map.put((String) extra[i], extra[i + 1]);
    return new tools.jackson.databind.ObjectMapper()
        .convertValue(map, MaterialSearch.Filters.class);
  }

  List<UUID> ids(MaterialSearch.Filters f) {
    return catalog.search(f, 25, null).items().stream().map(MaterialService.View::id).toList();
  }

  @Test
  void physicalFiltersUseMaterialOriginCompositionAndRanges() {
    var m =
        materials.create(
            new MaterialService.Input(
                catalogSupplier,
                "search-article",
                MaterialService.Type.FABRIC,
                "Synthetic cloth",
                null,
                CN,
                MaterialService.Completeness.COMPLETE,
                List.of(
                    new MaterialService.Part(fiber("WOOL"), new BigDecimal("80")),
                    new MaterialService.Part(fiber("COTTON"), new BigDecimal("20"))),
                MaterialService.Status.ACTIVE,
                observation,
                0));
    material(MaterialService.Type.LEATHER);
    jdbc.sql(
            "INSERT INTO fabric_spec(material_id,material_type,gsm,width_mm,thickness_mm)"
                + " VALUES(:id,'FABRIC',200,1500,1.5)")
        .param("id", m.id())
        .update();
    assertThat(
            ids(
                "materialType",
                "FABRIC",
                "originCountryId",
                CN,
                "fiberTypeId",
                fiber("WOOL"),
                "minFiberPercentage",
                70,
                "maxFiberPercentage",
                90,
                "minGsm",
                190,
                "maxGsm",
                210,
                "minWidthMm",
                1400,
                "maxWidthMm",
                1600,
                "minThicknessMm",
                1,
                "maxThicknessMm",
                2,
                "q",
                "search-article"))
        .containsExactly(m.id());
    assertThat(ids("originCountryId", JP)).isEmpty();
    assertThat(ids("fiberTypeId", fiber("WOOL"), "minFiberPercentage", 81)).isEmpty();
    assertThat(ids("minGsm", 201)).isEmpty();
    assertThat(ids("q", "' OR true --")).isEmpty();
  }

  @Test
  void variantColorAndExplicitVariantMustBelongToSameMaterial() {
    var a = material();
    var b = material();
    var v =
        materials.createVariant(
            new MaterialService.VariantInput(
                a.id(),
                "red",
                "Red",
                "Scarlet",
                "R01",
                null,
                null,
                MaterialService.VariantStatus.ACTIVE,
                observation,
                0));
    var wrong = variant(b.id());
    assertThat(ids("color", "scarlet", "variantId", v.id())).containsExactly(a.id());
    assertThat(ids("color", "scarlet", "variantId", wrong.id())).isEmpty();
  }

  @Test
  void allListingFiltersApplyToOneListing() {
    var m = material();
    UUID other = supplier(JP, "Synthetic other seller").id();
    offer(m.id(), seller, "100", "5", MeasurementUnit.METER, 1);
    offer(m.id(), other, "10", "20", MeasurementUnit.METER, 30);
    assertThat(ids("sellerSupplierId", seller, "maxMoq", 50, "maxLeadTimeDays", 10)).isEmpty();
    assertThat(ids("sellerSupplierId", other, "maxMoq", 50, "maxLeadTimeDays", 10)).isEmpty();
    assertThat(
            ids(
                "sellerSupplierId",
                other,
                "maxMoq",
                50,
                "maxMcq",
                20,
                "quantityUnit",
                "METER",
                "minLeadTimeDays",
                20,
                "maxLeadTimeDays",
                30,
                "listingStatus",
                "ACTIVE"))
        .containsExactly(m.id());
    assertThat(ids("sellerSupplierId", other, "maxMcq", 19)).isEmpty();
    assertThat(ids("quantityUnit", "YARD")).isEmpty();
  }

  @Test
  void unknownTermsOnlyExcludeWhenExplicitlyFilteredAndNoListingIsRequiredForDiscovery() {
    var m = material();
    listing(m.id());
    var noListing = material();
    assertThat(ids()).containsExactlyInAnyOrder(m.id(), noListing.id());
    assertThat(ids("sellerSupplierId", seller)).containsExactly(m.id());
    for (String term : List.of("maxMoq", "maxMcq", "maxLeadTimeDays"))
      assertThat(ids(term, 50)).isEmpty();
  }

  @Test
  void priceSearchUsesWinningTierNotAnyCheaperHistoricalRow() {
    var m = material();
    var l = offer(m.id(), seller, "1000", null, MeasurementUnit.METER, 2);
    price(l.id(), null, "1", null, "USD", MeasurementUnit.METER);
    price(l.id(), null, "200", "10", "USD", MeasurementUnit.METER);
    assertThat(ids(priced("100", "requestedQuantity", 20))).isEmpty();
    assertThat(ids(priced("100"))).containsExactly(m.id());
    assertThat(ids(priced("300", "requestedQuantity", 20))).containsExactly(m.id());
    listings.update(
        l.id(),
        new ListingService.Input(
            m.id(),
            seller,
            "archived",
            new BigDecimal("9000"),
            null,
            MeasurementUnit.METER,
            2,
            null,
            ListingService.Status.ARCHIVED,
            observation,
            0));
    assertThat(ids(priced("300", "requestedQuantity", 20))).containsExactly(m.id());
    assertThat(ids(priced("300", "requestedQuantity", 20, "maxMoq", 100))).isEmpty();
  }

  @Test
  void sellerAndPriceMustBeOnSameListingAndScopeNeverConvertsCurrencyOrUnit() {
    var m = material();
    UUID other = supplier(JP, "Synthetic alternate seller").id();
    var a = offer(m.id(), seller, null, null, null, null);
    var b = offer(m.id(), other, null, null, null, null);
    price(a.id(), null, "1", null, "USD", MeasurementUnit.METER);
    price(b.id(), null, "1", null, "JPY", MeasurementUnit.METER);
    price(b.id(), null, "1", null, "USD", MeasurementUnit.YARD);
    assertThat(ids(priced("10", "sellerSupplierId", other))).isEmpty();
    assertThat(ids(priced("10", "sellerSupplierId", seller))).containsExactly(m.id());
    assertThat(ids(priced("10", "priceDataSourceId", UUID.randomUUID()))).isEmpty();
  }

  @Test
  void variantPriceDefaultsToExactAndExplicitFallbackCannotBeatExistingExactPrice() {
    var m = material();
    var l = listing(m.id());
    var v = variant(m.id());
    price(l.id(), null, "1", null, "USD", MeasurementUnit.METER);
    assertThat(ids(priced("10", "variantId", v.id()))).isEmpty();
    assertThat(ids(priced("10", "variantId", v.id(), "allowMaterialFallback", true)))
        .containsExactly(m.id());
    price(l.id(), v.id(), "100", null, "USD", MeasurementUnit.METER);
    assertThat(ids(priced("10", "variantId", v.id(), "allowMaterialFallback", true))).isEmpty();
    assertThat(ids(priced("200", "variantId", v.id()))).containsExactly(m.id());
  }

  @Test
  void priceSearchRequiresExplicitComparableScopeAndRejectsInvalidFilters() {
    for (var f :
        List.of(
            filter("maxPrice", 10),
            filter("currency", "USD"),
            filter("maxMoq", -1),
            filter("minGsm", 20, "maxGsm", 10),
            filter("minFiberPercentage", 10),
            filter("maxLeadTimeDays", -1)))
      assertThatThrownBy(() -> catalog.search(f, 25, null)).isInstanceOf(RuntimeException.class);
  }

  @Test
  void materialKeysetsAreStableBoundedAndTiedToFilters() {
    for (int i = 0; i < 4; i++) material();
    var f = filter();
    var first = catalog.search(f, 2, null);
    var second = catalog.search(f, 2, first.nextCursor());
    assertThat(first.items()).hasSize(2);
    assertThat(second.items()).hasSize(2);
    assertThat(second.nextCursor()).isNull();
    assertThat(first.items())
        .extracting(MaterialService.View::id)
        .doesNotContainAnyElementsOf(
            second.items().stream().map(MaterialService.View::id).toList());
    for (String cursor :
        List.of(
            "bad",
            Keysets.encode("created-desc", Keysets.hash(f), "not-a-date|" + id()),
            Keysets.encode("other-sort", Keysets.hash(f), AT + "|" + id())))
      assertThatThrownBy(() -> catalog.search(f, 25, cursor)).isInstanceOf(RuntimeException.class);
    assertThatThrownBy(() -> catalog.search(filter("status", "ARCHIVED"), 2, first.nextCursor()))
        .isInstanceOf(RuntimeException.class);
    assertThatThrownBy(() -> catalog.search(f, 101, null)).isInstanceOf(RuntimeException.class);
  }

  @Test
  void readRoutesExposeAllRequiredBoundedResources() throws Exception {
    var m = material();
    var l = listing(m.id());
    var v = variant(m.id());
    price(l.id(), null, "1", null, "USD", MeasurementUnit.METER);
    for (String route :
        List.of(
            "/materials",
            "/materials/" + m.id(),
            "/materials/" + m.id() + "/variants",
            "/material-variants/" + v.id(),
            "/materials/" + m.id() + "/listings",
            "/material-listings/" + l.id(),
            "/suppliers/" + catalogSupplier + "/catalog-materials",
            "/suppliers/" + seller + "/material-listings",
            "/fiber-types",
            "/material-listings/" + l.id() + "/prices",
            "/material-listings/" + l.id() + "/effective-prices",
            "/material-listings/" + l.id() + "/inventory-snapshots",
            "/material-listings/" + l.id() + "/inventory"))
      mvc.perform(get("/api/v1" + route).header("X-Dev-Subject", principal))
          .andExpect(status().isOk());
    mvc.perform(
            get("/api/v1/materials")
                .header("X-Dev-Subject", principal)
                .param("catalogSupplierId", catalogSupplier.toString())
                .param("materialType", "FABRIC")
                .param("limit", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].id").value(m.id().toString()));
  }
}
