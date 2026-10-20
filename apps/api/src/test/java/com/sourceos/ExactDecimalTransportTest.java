package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.facility.FacilityService;
import com.sourceos.material.MaterialService;
import com.sourceos.materialinventory.InventoryService;
import com.sourceos.materiallisting.ListingService;
import com.sourceos.materialprice.PriceService;
import com.sourceos.shared.MeasurementUnit;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class ExactDecimalTransportTest extends CatalogIntegrationSupport {
  static final String LARGE = "999999999999999.9999";
  static final Instant AT = Instant.parse("2026-01-01T00:00:00Z");
  @Autowired JsonMapper json;
  @Autowired PriceService prices;
  @Autowired InventoryService inventory;

  @Test
  void priceAmountRoundTripsAtNumeric19Scale4Limit() throws Exception {
    var l = listing(material().id());
    var input =
        new PriceService.Input(
            l.id(),
            null,
            source,
            new BigDecimal(LARGE),
            "USD",
            MeasurementUnit.METER,
            null,
            AT,
            null,
            AT,
            List.of(observation));
    var response = command(post("/api/v1/admin/material-prices"), input);
    assertDecimal(response, "amount", LARGE);
    var stored = prices.read(UUID.fromString(response.path("id").asText()));
    assertThat(stored.amount()).isEqualByComparingTo(LARGE);
    var decoded = json.readValue(json.writeValueAsString(input), PriceService.Input.class);
    assertThat(decoded.amount()).isEqualByComparingTo(stored.amount());
    mvc.perform(
            post("/api/v1/admin/material-prices")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(json.writeValueAsString(input).replace(LARGE, "0")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void listingMoqAndMcqRoundTripWithoutJavascriptNumber() throws Exception {
    var input =
        listingInput(
            material().id(),
            new BigDecimal(LARGE),
            new BigDecimal("0.0001"),
            MeasurementUnit.METER,
            ListingService.Status.ACTIVE,
            0);
    var response = command(post("/api/v1/admin/material-listings"), input);
    assertDecimal(response, "minimumOrderQuantity", LARGE);
    assertDecimal(response, "minimumColorQuantity", "0.0001");
    var stored = listings.read(UUID.fromString(response.path("id").asText()));
    assertThat(stored.minimumOrderQuantity()).isEqualByComparingTo(LARGE);
    assertThat(
            json.readValue(json.writeValueAsString(input), ListingService.Input.class)
                .minimumOrderQuantity())
        .isEqualByComparingTo(stored.minimumOrderQuantity());
  }

  @Test
  void inventoryQuantityRoundTripsAndZeroRemainsKnownZero() throws Exception {
    var l = listing(material().id());
    for (String quantity : List.of(LARGE, "0")) {
      var input =
          new InventoryService.Input(
              l.id(),
              null,
              null,
              new BigDecimal(quantity),
              MeasurementUnit.METER,
              InventoryService.Mode.MANUAL,
              AT,
              null,
              "decimal-" + id());
      var response = command(post("/api/v1/admin/material-inventory-snapshots"), input);
      assertDecimal(response, "quantity", quantity);
      assertThat(
              jdbc.sql("SELECT quantity FROM material_inventory_snapshot WHERE id=:id")
                  .param("id", UUID.fromString(response.path("id").asText()))
                  .query(BigDecimal.class)
                  .single())
          .isEqualByComparingTo(quantity);
      assertThat(
              json.readValue(json.writeValueAsString(input), InventoryService.Input.class)
                  .quantity())
          .isEqualByComparingTo(quantity);
    }
    var negative =
        new InventoryService.Input(
            l.id(),
            null,
            null,
            new BigDecimal("-0.0001"),
            MeasurementUnit.METER,
            InventoryService.Mode.MANUAL,
            AT,
            null,
            "invalid-" + id());
    mvc.perform(
            post("/api/v1/admin/material-inventory-snapshots")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(json.writeValueAsString(negative)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void compositionPercentagePreservesFourDecimalPlacesAndBounds() throws Exception {
    var m = material();
    var input =
        new MaterialService.CompositionInput(
            MaterialService.Completeness.PARTIAL,
            List.of(new MaterialService.Part(fiber("COTTON"), new BigDecimal("99.9999"))),
            observation,
            0);
    var response = command(put("/api/v1/admin/materials/" + m.id() + "/composition"), input);
    assertDecimal(response.path("composition").get(0), "percentage", "99.9999");
    assertThat(materials.read(m.id()).composition().getFirst().percentage())
        .isEqualByComparingTo("99.9999");
    assertThat(
            json.readValue(json.writeValueAsString(input), MaterialService.CompositionInput.class)
                .parts()
                .getFirst()
                .percentage())
        .isEqualByComparingTo("99.9999");
    mvc.perform(
            put("/api/v1/admin/materials/" + m.id() + "/composition")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(json.writeValueAsString(input).replace("99.9999", "100.0001")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void fabricDecimalsRoundTripAcrossNarrowerPhysicalRanges() throws Exception {
    var m = material();
    var input =
        new MaterialService.FabricInput(
            MaterialService.Construction.WOVEN,
            null,
            null,
            new BigDecimal("999999.9999"),
            new BigDecimal("99999999.9999"),
            new BigDecimal("0.0001"),
            new BigDecimal("99999.9999"),
            null,
            new BigDecimal("-99.9999"),
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            observation,
            0);
    var response = command(put("/api/v1/admin/materials/" + m.id() + "/fabric-spec"), input);
    assertDecimal(response, "gsm", "999999.9999");
    assertDecimal(response, "widthMm", "99999999.9999");
    assertDecimal(response, "thicknessMm", "0.0001");
    assertDecimal(response, "stretchWarpPercentage", "99999.9999");
    assertDecimal(response, "shrinkageWarpPercentage", "-99.9999");
    assertThat(materials.fabric(m.id()).gsm()).isEqualByComparingTo("999999.9999");
    assertThat(
            json.readValue(json.writeValueAsString(input), MaterialService.FabricInput.class)
                .widthMm())
        .isEqualByComparingTo("99999999.9999");
  }

  @Test
  void facilityCoordinatesAndCapabilityQuantitiesUseTheSameExactContract() throws Exception {
    var input =
        new FacilityService.Input(
            catalogSupplier,
            FacilityService.Type.MILL,
            "Synthetic exact coordinates",
            JP,
            null,
            null,
            null,
            null,
            null,
            new BigDecimal("89.999999"),
            new BigDecimal("-179.999999"),
            null,
            null,
            FacilityService.Status.ACTIVE,
            observation,
            0);
    var response = command(post("/api/v1/admin/facilities"), input);
    assertDecimal(response, "latitude", "89.999999");
    assertDecimal(response, "longitude", "-179.999999");
    UUID facility = UUID.fromString(response.path("id").asText());
    assertThat(facilities.read(facility).latitude()).isEqualByComparingTo("89.999999");
    assertThat(
            json.readValue(json.writeValueAsString(input), FacilityService.Input.class).longitude())
        .isEqualByComparingTo("-179.999999");
    actor(principal);
    UUID capabilityId = capability(null);
    var capability =
        new FacilityService.CapabilityInput(
            FacilityService.Proficiency.SPECIALIST,
            new BigDecimal("0.0001"),
            new BigDecimal(LARGE),
            FacilityService.Unit.METER,
            null,
            FacilityService.Verification.DOCUMENTED,
            observation,
            0);
    mvc.perform(
            put("/api/v1/admin/facilities/" + facility + "/capabilities/" + capabilityId)
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(json.writeValueAsString(capability)))
        .andExpect(status().isOk());
    var assignments =
        json.readTree(
            mvc.perform(
                    get("/api/v1/facilities/" + facility + "/capabilities")
                        .header("X-Dev-Subject", principal))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    assertDecimal(assignments.get(0), "maximumOrderQuantity", LARGE);
    mvc.perform(
            post("/api/v1/admin/facilities")
                .header("X-Dev-Subject", principal)
                .contentType("application/json")
                .content(json.writeValueAsString(input).replace("89.999999", "90.000001")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void serializerIsPlainAndNullSafeWhileStandardRequestsRemainCompatible() {
    for (String value : List.of("1E+3", "2.5E-4", "10.2500", LARGE)) {
      var decimal = new BigDecimal(value);
      var encoded = json.writeValueAsString(decimal);
      assertThat(encoded).isEqualTo("\"" + decimal.toPlainString() + "\"");
      assertThat(json.readValue(encoded, BigDecimal.class)).isEqualByComparingTo(decimal);
    }
    assertThat(json.readValue("10.2500", BigDecimal.class)).isEqualByComparingTo("10.2500");
    assertThat(json.writeValueAsString(null)).isEqualTo("null");
    assertThatThrownBy(() -> json.readValue("\"not-a-decimal\"", BigDecimal.class))
        .isInstanceOf(tools.jackson.core.JacksonException.class);
  }

  private JsonNode command(MockHttpServletRequestBuilder request, Object body) throws Exception {
    return json.readTree(
        mvc.perform(
                request
                    .header("X-Dev-Subject", principal)
                    .contentType("application/json")
                    .content(json.writeValueAsString(body)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString());
  }

  private void assertDecimal(JsonNode response, String field, String expected) {
    // Parsing JSON into a string, then binding that very string to BigDecimal, never via double.
    assertThat(response.path(field).isString()).as(field).isTrue();
    assertThat(new BigDecimal(response.path(field).asText())).isEqualByComparingTo(expected);
  }
}
