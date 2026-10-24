package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.styledevelopmentreference.StyleDevelopmentReferenceService;
import com.sourceos.stylefacilitycandidate.StyleFacilityCandidateService;
import com.sourceos.stylematerialselection.StyleMaterialSelectionService;
import com.sourceos.stylerequirement.StyleRequirementService;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockPart;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/** Test-only integrated fixture: both Organizations own all four Style children. */
abstract class PhaseTwoCumulativeSupport extends StyleDevelopmentReferenceSupport {
  @Autowired StyleMaterialSelectionService selections;
  @Autowired StyleFacilityCandidateService candidates;
  @Autowired StyleRequirementService requirements;
  UUID material, variant, listing, facility, otherFacility, supplier;
  UUID selection, foreignSelection, candidate, foreignCandidate;
  StyleDevelopmentReferenceService.View reference, foreignReference;
  String administrator, viewer, platform, stranger;

  @BeforeEach
  void cumulativeFixture() {
    administrator = "cumulative-admin-" + id();
    viewer = "cumulative-viewer-" + id();
    stranger = "cumulative-nonmember-" + id();
    platform = admin();
    membership(org, administrator, "ORG_ADMIN", "ACTIVE");
    membership(org, viewer, "VIEWER", "ACTIVE");
    supplier = id();
    material = id();
    variant = id();
    listing = id();
    facility = id();
    otherFacility = id();
    jdbc.sql(
            "INSERT INTO supplier_profile(id,country_id,display_name,normalized_name) SELECT"
                + " :id,id,'Synthetic cumulative supplier','synthetic' FROM country WHERE"
                + " alpha2='KR'")
        .param("id", supplier)
        .update();
    jdbc.sql(
            "INSERT INTO"
                + " material(id,catalog_supplier_id,material_type,display_name,normalized_name,status)"
                + " VALUES(:id,:s,'FABRIC','Synthetic cumulative material','synthetic','ACTIVE')")
        .param("id", material)
        .param("s", supplier)
        .update();
    jdbc.sql(
            "INSERT INTO material_variant(id,material_id,variant_name) VALUES(:id,:m,'Synthetic"
                + " cumulative variant')")
        .param("id", variant)
        .param("m", material)
        .update();
    jdbc.sql(
            "INSERT INTO supplier_material_listing(id,material_id,seller_supplier_id)"
                + " VALUES(:id,:m,:s)")
        .param("id", listing)
        .param("m", material)
        .param("s", supplier)
        .update();
    for (UUID f : List.of(facility, otherFacility))
      jdbc.sql(
              "INSERT INTO facility(id,supplier_id,facility_type,name,country_id) SELECT"
                  + " :id,id,'FACTORY','Synthetic cumulative facility',country_id FROM"
                  + " supplier_profile WHERE id=:s")
          .param("id", f)
          .param("s", supplier)
          .update();
    var input = new StyleMaterialSelectionService.Input(material, variant, listing);
    var req =
        new StyleRequirementService.Input(
            "Synthetic private target", null, null, null, null, null, null, 0L);
    actor(owner);
    requirements.write(org, project.id(), style.id(), req, "*", "cumulative-fixture");
    selection = selections.add(org, project.id(), style.id(), input, "cumulative-fixture").id();
    candidate =
        candidates
            .add(
                org,
                project.id(),
                style.id(),
                new StyleFacilityCandidateService.Input(facility),
                "cumulative-fixture")
            .id();
    reference =
        references.upload(
            org,
            project.id(),
            style.id(),
            "Synthetic retained private name",
            new byte[] {7, 8, 9},
            "cumulative-fixture");
    actor(foreignOwner);
    requirements.write(
        foreignOrg, foreignProject.id(), foreignStyle.id(), req, "*", "cumulative-fixture");
    foreignSelection =
        selections
            .add(foreignOrg, foreignProject.id(), foreignStyle.id(), input, "cumulative-fixture")
            .id();
    foreignCandidate =
        candidates
            .add(
                foreignOrg,
                foreignProject.id(),
                foreignStyle.id(),
                new StyleFacilityCandidateService.Input(facility),
                "cumulative-fixture")
            .id();
    foreignReference =
        references.upload(
            foreignOrg,
            foreignProject.id(),
            foreignStyle.id(),
            "Synthetic foreign retained name",
            new byte[] {4, 5, 6},
            "cumulative-fixture");
    actor(owner);
  }

  String root() {
    return detail(true);
  }

  List<String> reads() {
    return List.of(
        collection(false),
        detail(false),
        collection(true),
        root(),
        root() + "/requirement",
        root() + "/material-selections",
        root() + "/facility-candidates",
        path(),
        path() + "/" + reference.id(),
        path() + "/" + reference.id() + "/content");
  }

  record Command(String method, String url, Object body, int success) {}

  List<Command> childCommands() {
    return List.of(
        new Command(
            "PUT",
            root() + "/requirement",
            Map.of("productType", "Synthetic replacement", "version", 0),
            200),
        new Command("POST", root() + "/material-selections", Map.of("materialId", material), 201),
        new Command("DELETE", root() + "/material-selections/" + selection, null, 204),
        new Command(
            "POST", root() + "/facility-candidates", Map.of("facilityId", otherFacility), 201),
        new Command("DELETE", root() + "/facility-candidates/" + candidate, null, 204),
        new Command("POST", path() + "/" + reference.id() + "/detach", Map.of("version", 1), 200));
  }

  ResultActions multipart(String subject) throws Exception {
    var name =
        new MockPart("displayName", "Synthetic cumulative upload".getBytes(StandardCharsets.UTF_8));
    name.getHeaders().setContentType(MediaType.TEXT_PLAIN);
    var file = new MockPart("file", "synthetic.bin", new byte[] {1, 2, 3});
    file.getHeaders().setContentType(MediaType.APPLICATION_OCTET_STREAM);
    return mvc.perform(
        MockMvcRequestBuilders.multipart(path())
            .part(name, file)
            .header("X-Dev-Subject", subject)
            .header("X-Request-ID", "workspace-reference"));
  }

  long audits() {
    return jdbc.sql("SELECT count(*) FROM audit_event WHERE organization_id=:org")
        .param("org", org)
        .query(Long.class)
        .single();
  }

  List<String> snapshot(String table, String predicate, UUID id) {
    return jdbc.sql(
            "SELECT row_to_json(t)::text FROM "
                + table
                + " t WHERE "
                + predicate
                + "=:id ORDER BY 1")
        .param("id", id)
        .query(String.class)
        .list();
  }

  Map<String, List<String>> children() {
    var result = new LinkedHashMap<String, List<String>>();
    for (String table :
        List.of(
            "style_requirement",
            "style_material_selection",
            "style_facility_candidate",
            "style_development_reference"))
      result.put(table, snapshot(table, "style_id", style.id()));
    return result;
  }

  Map<String, List<String>> supply() {
    var result = new LinkedHashMap<String, List<String>>();
    for (String table :
        List.of(
            "material",
            "material_variant",
            "supplier_material_listing",
            "material_price",
            "material_inventory_snapshot",
            "facility",
            "supplier_profile",
            "facility_capability",
            "capability"))
      result.put(
          table,
          jdbc.sql("SELECT row_to_json(t)::text FROM " + table + " t ORDER BY 1")
              .query(String.class)
              .list());
    return result;
  }
}
