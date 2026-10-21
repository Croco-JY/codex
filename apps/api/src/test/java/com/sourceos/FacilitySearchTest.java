package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.capability.CapabilityService;
import com.sourceos.dataingestion.SourceService;
import com.sourceos.facility.FacilityService;
import com.sourceos.geography.GeographyService;
import com.sourceos.supplier.SupplierService;
import com.sourceos.supplysearch.DirectorySearch;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class FacilitySearchTest extends DirectoryIntegrationSupport {
  @Test
  void companyAndFacilityCountriesAreIndependent() {
    var s = supplier(JP, "Synthetic overseas " + id());
    var f = facility(s.id(), CN, null, null);
    assertThat(f.supplierId()).isEqualTo(s.id());
    assertThat(f.countryId()).isEqualTo(CN);
    assertThat(f.latitude()).isNull();
    assertThat(f.longitude()).isNull();
  }

  @Test
  void facilityRegionAndClusterMustBeConsistent() {
    var s = supplier(JP, "Synthetic geography " + id());
    UUID jp = region(JP, null), cn = region(CN, null), other = region(CN, null);
    UUID cluster =
        geography.cluster(
            null,
            new GeographyService.ClusterInput(
                CN, cn, "cluster-" + id(), "Synthetic cluster", null, null, true, 0));
    assertThatThrownBy(() -> facility(s.id(), CN, jp, null))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(() -> facility(s.id(), JP, jp, cluster))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(() -> facility(s.id(), CN, other, cluster))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    UUID child = region(CN, cn);
    var valid = facility(s.id(), CN, child, cluster);
    assertThat(valid.regionId()).isEqualTo(child);
    assertThatThrownBy(
            () ->
                jdbc.sql("UPDATE region SET parent_region_id=:other WHERE id=:child")
                    .param("other", other)
                    .param("child", child)
                    .update())
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }

  @Test
  void ownerCannotBeReassignedAndVersionConflicts() {
    var a = supplier(JP, "Synthetic owner A " + id());
    var b = supplier(JP, "Synthetic owner B " + id());
    var f = facility(a.id(), JP, null, null);
    assertThatThrownBy(() -> facilities.update(f.id(), facilityInput(b.id(), JP, null, null, 0)))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    var updated = facilities.update(f.id(), facilityInput(a.id(), JP, null, null, 0));
    assertThat(updated.version()).isEqualTo(1);
    assertThatThrownBy(() -> facilities.update(f.id(), facilityInput(a.id(), JP, null, null, 0)))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
  }

  @Test
  void capabilityHierarchyRejectsCyclesAndCategoryMismatch() {
    UUID root = capability(null), child = capability(root);
    assertThatThrownBy(
            () ->
                jdbc.sql("UPDATE capability SET parent_id=id WHERE id=:id")
                    .param("id", root)
                    .update())
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                jdbc.sql("UPDATE capability SET parent_id=:child WHERE id=:root")
                    .param("child", child)
                    .param("root", root)
                    .update())
        .hasMessageContaining("cycle");
    assertThatThrownBy(
            () ->
                capabilities.save(
                    null,
                    new CapabilityService.Input(
                        "PRODUCT_" + id().toString().replace("-", "").toUpperCase(Locale.ROOT),
                        root,
                        CapabilityService.Category.PRODUCT,
                        "Synthetic",
                        null,
                        null,
                        true,
                        0)))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }

  @Test
  void capabilityUnknownQuantitiesRemainNullAndHaveProvenance() {
    var s = supplier(JP, "Synthetic quantities " + id());
    var f = facility(s.id(), JP, null, null);
    UUID c = capability(null);
    assign(f.id(), c);
    var stored = facilities.capabilities(f.id()).getFirst();
    assertThat(stored.minimumOrderQuantity()).isNull();
    assertThat(stored.maximumOrderQuantity()).isNull();
    assertThat(stored.quantityUnit()).isNull();
    assertThat(
            jdbc.sql(
                    "SELECT source_observation_id FROM facility_capability_source WHERE"
                        + " facility_id=:id AND capability_id=:capability")
                .param("id", f.id())
                .param("capability", c)
                .query(UUID.class)
                .single())
        .isEqualTo(observation);
    assertThatThrownBy(
            () ->
                facilities.assign(
                    f.id(),
                    c,
                    new FacilityService.CapabilityInput(
                        null,
                        new BigDecimal("-1"),
                        null,
                        FacilityService.Unit.METER,
                        null,
                        FacilityService.Verification.UNVERIFIED,
                        observation,
                        0),
                    null))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        "UPDATE facility_capability SET quantity_unit=NULL,minimum_order_quantity=1"
                            + " WHERE facility_id=:id")
                    .param("id", f.id())
                    .update())
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }

  @Test
  void staleCapabilityAssignmentCannotOverwriteOrAppendAudit() {
    var supplier = supplier(JP, "Synthetic assignment concurrency " + id());
    var facility = facility(supplier.id(), JP, null, null);
    UUID capability = capability(null);
    assign(facility.id(), capability);
    var input =
        new FacilityService.CapabilityInput(
            FacilityService.Proficiency.SPECIALIST,
            new BigDecimal("12.5000"),
            null,
            FacilityService.Unit.METER,
            null,
            FacilityService.Verification.DOCUMENTED,
            observation,
            0);
    facilities.assign(facility.id(), capability, input, null);
    long auditCount =
        jdbc.sql("SELECT count(*) FROM audit_event WHERE entity_id=:id")
            .param("id", facility.id())
            .query(Long.class)
            .single();
    assertThatThrownBy(() -> facilities.assign(facility.id(), capability, input, null))
        .isInstanceOfSatisfying(
            org.springframework.web.server.ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
    var stored = facilities.capabilities(facility.id()).getFirst();
    assertThat(stored.version()).isEqualTo(1);
    assertThat(stored.minimumOrderQuantity()).isEqualByComparingTo("12.5");
    assertThat(
            jdbc.sql("SELECT count(*) FROM audit_event WHERE entity_id=:id")
                .param("id", facility.id())
                .query(Long.class)
                .single())
        .isEqualTo(auditCount);
  }

  @Test
  void facilityBindingAndCitationAreDifferent() {
    var s = supplier(JP, "Synthetic facility identity " + id());
    var f = facility(s.id(), JP, null, null);
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        "INSERT INTO facility_external_record(source_record_id,facility_id)"
                            + " VALUES(:record,:facility)")
                    .param("record", record)
                    .param("facility", f.id())
                    .update())
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    UUID external =
        sources
            .record(
                new SourceService.RecordInput(
                    source, SourceService.RecordKind.FACILITY, "facility"))
            .id();
    facilities.bindIdentity(f.id(), external);
    assertThatThrownBy(
            () ->
                facilities.citation(
                    f.id(), new FacilityService.Citation(external, FacilityService.Fact.RECORD)))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThat(facilities.citations(f.id())).hasSize(1);
  }

  @Test
  void facilityImportReusesIdentity() {
    var s = supplier(JP, "Synthetic import facility " + id());
    UUID external =
        sources
            .record(
                new SourceService.RecordInput(
                    source, SourceService.RecordKind.FACILITY, "facility-import"))
            .id();
    UUID obs = observation(external);
    var input =
        new FacilityService.Input(
            s.id(),
            FacilityService.Type.MILL,
            "Synthetic imported facility",
            JP,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            FacilityService.Status.ACTIVE,
            obs,
            0);
    var cmd = new FacilityService.IdentityInput(external, input);
    assertThat(facilities.resolveIdentity(cmd).id())
        .isEqualTo(facilities.resolveIdentity(cmd).id());
  }

  @Test
  void allCombinedPredicatesMatchSameFacility() {
    String name = "Synthetic split " + id();
    var s = supplier(JP, name);
    UUID cnRegion = region(CN, null);
    UUID cluster =
        geography.cluster(
            null,
            new GeographyService.ClusterInput(
                CN, cnRegion, "search-" + id(), "Synthetic search cluster", null, null, true, 0));
    var china = facility(s.id(), CN, cnRegion, cluster);
    var japan = facility(s.id(), JP, null, null);
    UUID heavy = capability(null);
    assign(japan.id(), heavy);
    var combined =
        filter(
            name,
            "JP",
            "CN",
            cnRegion,
            cluster,
            heavy,
            SupplierService.Role.MILL,
            SupplierService.Verification.DISCOVERED);
    assertThat(search.suppliers(combined, 25, null).items()).isEmpty();
    assign(china.id(), heavy);
    assertThat(search.suppliers(combined, 25, null).items())
        .extracting(x -> x.id())
        .containsExactly(s.id());
    assertThat(
            search
                .suppliers(filter(name, "CN", null, null, null, null, null, null), 25, null)
                .items())
        .isEmpty();
    assertThat(
            search
                .suppliers(
                    filter(
                        name,
                        null,
                        null,
                        null,
                        null,
                        null,
                        SupplierService.Role.LOGISTICS_COMPANY,
                        null),
                    25,
                    null)
                .items())
        .isEmpty();
    assertThat(
            search
                .suppliers(
                    filter(
                        name,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        SupplierService.Verification.AUDITED),
                    25,
                    null)
                .items())
        .isEmpty();
    var selected =
        search.facilities(
            new DirectorySearch.FacilityFilters(
                "CN", cnRegion, cluster, FacilityService.Type.MILL, heavy, s.id()),
            25,
            null);
    assertThat(selected.items()).extracting(x -> x.id()).containsExactly(china.id());
    assertThat(
            search
                .facilities(
                    new DirectorySearch.FacilityFilters(
                        "CN", cnRegion, cluster, FacilityService.Type.OFFICE, heavy, s.id()),
                    25,
                    null)
                .items())
        .isEmpty();
  }

  @Test
  void keysetCursorIsStableBoundedAndFilterSpecific() {
    String prefix = "Synthetic pages " + id();
    for (int n = 0; n < 3; n++) supplier(JP, prefix + " " + n);
    var f = filter(prefix, null, null, null, null, null, null, null);
    var first = search.suppliers(f, 1, null);
    var second = search.suppliers(f, 1, first.nextCursor());
    String raw =
        new String(
            java.util.Base64.getUrlDecoder().decode(first.nextCursor()),
            java.nio.charset.StandardCharsets.UTF_8);
    String[] parts = raw.split("~");
    parts[2] = "invalid-date";
    String forged =
        java.util.Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(
                String.join("~", parts).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    assertThatThrownBy(() -> search.suppliers(f, 1, forged))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    assertThat(first.items()).hasSize(1);
    assertThat(second.items()).hasSize(1);
    assertThat(first.items().getFirst().id()).isNotEqualTo(second.items().getFirst().id());
    assertThatThrownBy(
            () ->
                search.suppliers(
                    filter(prefix, "CN", null, null, null, null, null, null),
                    1,
                    first.nextCursor()))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    assertThatThrownBy(() -> search.suppliers(f, 101, null))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    assertThatThrownBy(() -> search.suppliers(f, 25, "not-a-valid-cursor"))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
  }

  @Test
  void supplierWithoutFacilitiesAndLiteralSearch() {
    String name = "Synthetic no-site " + id();
    var s = supplier(JP, name);
    assertThat(
            search
                .suppliers(filter(name, null, null, null, null, null, null, null), 25, null)
                .items())
        .extracting(x -> x.id())
        .containsExactly(s.id());
    assertThat(
            search
                .suppliers(
                    filter("' OR 1=1 --", null, null, null, null, null, null, null), 25, null)
                .items())
        .isEmpty();
  }

  @Test
  void httpReadSearchAndProvenanceAuthorization() throws Exception {
    var s = supplier(JP, "Synthetic HTTP read " + id());
    var f = facility(s.id(), CN, null, null);
    mvc.perform(
            get("/api/v1/suppliers")
                .header("X-Dev-Subject", "reader")
                .param("country", "JP")
                .param("facilityCountry", "CN")
                .param("q", s.displayName()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].id").value(s.id().toString()));
    mvc.perform(
            get("/api/v1/suppliers/" + s.id() + "/facilities").header("X-Dev-Subject", "reader"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].id").value(f.id().toString()));
    mvc.perform(get("/api/v1/facilities/" + f.id()).header("X-Dev-Subject", "reader"))
        .andExpect(status().isOk());
    mvc.perform(
            get("/api/v1/admin/facilities/" + f.id() + "/sources")
                .header("X-Dev-Subject", "reader"))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/v1/suppliers").header("X-Dev-Subject", "reader").param("limit", "0"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.requestId").exists());
  }
}
