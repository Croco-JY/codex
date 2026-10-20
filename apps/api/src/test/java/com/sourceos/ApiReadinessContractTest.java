package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.facility.FacilityService;
import com.sourceos.material.MaterialService;
import com.sourceos.materialinventory.InventoryService;
import com.sourceos.materiallisting.ListingService;
import com.sourceos.materialprice.PriceService;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class ApiReadinessContractTest extends SupplyIntegrationSupport {
  private JsonNode spec;

  @BeforeEach
  void generatedSpec() throws Exception {
    spec =
        new ObjectMapper()
            .readTree(
                mvc.perform(get("/v3/api-docs"))
                    .andExpect(status().isOk())
                    .andReturn()
                    .getResponse()
                    .getContentAsString());
  }

  @Test
  void facilityOperationsUseFacilitySchemasAndFields() {
    response("/api/v1/facilities/{id}", "get", "FacilityView", false);
    for (String path : List.of("/api/v1/admin/facilities", "/api/v1/admin/facilities/{id}")) {
      String method = path.endsWith("{id}") ? "put" : "post";
      request(path, method, "FacilityInput");
      response(path, method, "FacilityView", false);
    }
    request("/api/v1/admin/facility-identities", "post", "FacilityIdentityInput");
    response("/api/v1/admin/facility-identities", "post", "FacilityView", false);
    ref(schema("FacilityIdentityInput").path("properties").path("facility"), "FacilityInput");
    assertThat(schema("FacilityIdentityInput").path("properties").has("supplier")).isFalse();
    for (String name : List.of("FacilityInput", "FacilityView")) {
      var fields = schema(name).path("properties");
      for (String field : List.of("supplierId", "facilityType", "name", "latitude", "longitude"))
        assertThat(fields.has(field)).as(name + "." + field).isTrue();
      assertThat(fields.has("displayName")).isFalse();
      assertThat(fields.has("roles")).isFalse();
    }
  }

  @Test
  void facilityAssignmentsAndReferenceCapabilitiesAreDifferentContracts() {
    response("/api/v1/facilities/{id}/capabilities", "get", "FacilityCapabilityView", true);
    request(
        "/api/v1/admin/facilities/{id}/capabilities/{capability}",
        "put",
        "FacilityCapabilityInput");
    response("/api/v1/capabilities", "get", "CapabilityView", true);
    request("/api/v1/admin/capabilities", "post", "CapabilityInput");
    request("/api/v1/admin/capabilities/{id}", "put", "CapabilityInput");
    assertThat(schema("FacilityCapabilityInput").path("properties").has("minimumOrderQuantity"))
        .isTrue();
    assertThat(schema("CapabilityInput").path("properties").has("code")).isTrue();
    assertThat(schema("CapabilityView").path("properties").has("nameEn")).isTrue();
    assertThat(schema("CapabilityView").path("properties").has("displayName")).isFalse();
  }

  @Test
  void supplierContractsRetainTheirOwnFieldsAndNestedCommands() {
    response("/api/v1/suppliers/{id}", "get", "SupplierView", false);
    request("/api/v1/admin/suppliers", "post", "SupplierInput");
    request("/api/v1/admin/suppliers/{id}", "put", "SupplierInput");
    response("/api/v1/admin/suppliers", "post", "SupplierView", false);
    response("/api/v1/admin/suppliers/{id}", "put", "SupplierView", false);
    request("/api/v1/admin/supplier-identities", "post", "SupplierIdentityInput");
    response("/api/v1/admin/supplier-identities", "post", "SupplierView", false);
    ref(schema("SupplierIdentityInput").path("properties").path("supplier"), "SupplierInput");
    for (String name : List.of("SupplierInput", "SupplierView")) {
      assertThat(schema(name).path("properties").has("displayName")).isTrue();
      assertThat(schema(name).path("properties").has("roles")).isTrue();
      assertThat(schema(name).path("properties").has("facilityType")).isFalse();
    }
    request("/api/v1/admin/suppliers/{id}/aliases", "post", "SupplierAliasInput");
    response("/api/v1/suppliers/{id}/aliases", "get", "SupplierAliasView", true);
    request(
        "/api/v1/admin/suppliers/{id}/verification-events", "post", "SupplierVerificationInput");
    response(
        "/api/v1/suppliers/{id}/verification-events", "get", "SupplierVerificationEvent", true);
  }

  @Test
  void citationsAndBindingsCannotResolveToAnotherDomainsSchema() {
    request("/api/v1/admin/suppliers/{id}/sources", "post", "SupplierCitation");
    request("/api/v1/admin/facilities/{id}/sources", "post", "FacilityCitation");
    assertThat(schema("SupplierCitation").path("properties").path("fieldName").toString())
        .contains("DISPLAY_NAME")
        .doesNotContain("COORDINATES");
    assertThat(schema("FacilityCitation").path("properties").path("fieldName").toString())
        .contains("COORDINATES")
        .doesNotContain("DISPLAY_NAME");
    request("/api/v1/admin/suppliers/{id}/external-records", "post", "SupplierBinding");
    request("/api/v1/admin/facilities/{id}/external-records", "post", "FacilityBinding");
    request("/api/v1/admin/materials/{id}/external-records", "post", "MaterialBinding");
    request("/api/v1/admin/material-listings/{id}/external-records", "post", "ListingBinding");
    for (String legacy : List.of("Input", "View", "IdentityInput", "Citation", "Binding"))
      assertThat(spec.path("components").path("schemas").has(legacy)).as(legacy).isFalse();
  }

  @Test
  void auditedGeographyAndIngestionSchemasRemainUnambiguous() {
    response("/api/v1/countries", "get", "Country", true);
    response("/api/v1/regions", "get", "Region", true);
    response("/api/v1/industrial-clusters", "get", "Cluster", true);
    request("/api/v1/admin/countries/{id}", "patch", "CountryInput");
    request("/api/v1/admin/regions", "post", "RegionInput");
    request("/api/v1/admin/industrial-clusters", "post", "ClusterInput");
    request("/api/v1/admin/sources", "post", "SourceInput");
    response("/api/v1/admin/sources", "get", "SourceView", true);
    request("/api/v1/admin/source-records", "post", "RecordInput");
    response("/api/v1/admin/source-records", "post", "RecordView", false);
    request("/api/v1/admin/source-observations", "post", "ObservationInput");
    response("/api/v1/admin/source-records/{id}/observations", "get", "Observation", true);
    request("/api/v1/admin/source-observations/{id}/reviews", "post", "ReviewInput");
    response("/api/v1/admin/source-observations/{id}/reviews", "get", "Review", true);
  }

  @Test
  void everyNamedApiBigDecimalFieldAndDecimalQueryParameterIsAString() {
    int checked = 0;
    for (var service :
        List.of(
            FacilityService.class,
            MaterialService.class,
            ListingService.class,
            PriceService.class,
            InventoryService.class)) {
      for (var dto : service.getDeclaredClasses()) {
        // MatchRequest is flattened into query parameters, verified separately below.
        if (dto == PriceService.MatchRequest.class
            || !dto.isRecord()
            || !dto.isAnnotationPresent(Schema.class)) continue;
        for (var component : dto.getRecordComponents()) {
          if (component.getType() != BigDecimal.class) continue;
          var field =
              schema(dto.getAnnotation(Schema.class).name())
                  .path("properties")
                  .path(component.getName());
          decimal(field);
          checked++;
        }
      }
    }
    assertThat(checked).isGreaterThanOrEqualTo(40);
    var filters = com.sourceos.materialsearch.MaterialSearch.Filters.class;
    for (String path : List.of("/api/v1/materials", "/api/v1/suppliers/{id}/catalog-materials")) {
      for (var component : filters.getRecordComponents()) {
        if (component.getType() != BigDecimal.class) continue;
        decimal(parameter(path, component.getName()));
      }
    }
    decimal(parameter("/api/v1/material-listings/{id}/effective-prices", "requestedQuantity"));
  }

  @Test
  void capabilitiesExposeOnlyABoolean() {
    response("/api/identity/capabilities", "get", "IdentityCapabilities", false);
    assertThat(schema("IdentityCapabilities").path("properties").size()).isEqualTo(1);
    assertThat(
            schema("IdentityCapabilities")
                .path("properties")
                .path("platformAdmin")
                .path("type")
                .asText())
        .isEqualTo("boolean");
  }

  private JsonNode parameter(String path, String name) {
    for (var parameter : spec.path("paths").path(path).path("get").path("parameters"))
      if (parameter.path("name").asText().equals(name)) return parameter.path("schema");
    throw new AssertionError("Missing parameter " + path + " " + name);
  }

  private void decimal(JsonNode field) {
    assertThat(field.path("type").asText()).as(field.toString()).isEqualTo("string");
    assertThat(field.path("format").asText()).isEqualTo("decimal");
  }

  private JsonNode schema(String name) {
    var result = spec.path("components").path("schemas").path(name);
    assertThat(result.isMissingNode()).as(name).isFalse();
    return result;
  }

  private void request(String path, String method, String name) {
    ref(
        spec.path("paths")
            .path(path)
            .path(method)
            .path("requestBody")
            .path("content")
            .path("application/json")
            .path("schema"),
        name);
  }

  private void response(String path, String method, String name, boolean array) {
    var result =
        spec.path("paths")
            .path(path)
            .path(method)
            .path("responses")
            .path("200")
            .path("content")
            .path("*/*")
            .path("schema");
    if (array) {
      assertThat(result.path("type").asText()).isEqualTo("array");
      result = result.path("items");
    }
    ref(result, name);
  }

  private void ref(JsonNode value, String name) {
    assertThat(value.path("$ref").asText()).isEqualTo("#/components/schemas/" + name);
  }
}
