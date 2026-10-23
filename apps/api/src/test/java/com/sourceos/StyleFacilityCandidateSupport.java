package com.sourceos;

import com.sourceos.facility.FacilityService;
import com.sourceos.stylefacilitycandidate.StyleFacilityCandidateService;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;

abstract class StyleFacilityCandidateSupport extends WorkspaceIntegrationSupport {
  @Autowired protected StyleFacilityCandidateService candidates;
  @Autowired protected FacilityService facilities;
  protected UUID facility, otherFacility, supplier;

  @BeforeEach
  void facilityFixture() {
    supplier = id();
    var country = jdbc.sql("SELECT id FROM country WHERE alpha2='KR'").query(UUID.class).single();
    jdbc.sql(
            "INSERT INTO supplier_profile(id,country_id,display_name,normalized_name)"
                + " VALUES(:id,:c,'Synthetic candidate supplier','synthetic')")
        .param("id", supplier)
        .param("c", country)
        .update();
    facility = facility();
    otherFacility = facility();
  }

  UUID facility() {
    var id = id();
    jdbc.sql(
            "INSERT INTO facility(id,supplier_id,facility_type,name,country_id) SELECT"
                + " :id,:s,'FACTORY','Synthetic candidate facility',country_id FROM"
                + " supplier_profile WHERE id=:s")
        .param("id", id)
        .param("s", supplier)
        .update();
    return id;
  }

  String path() {
    return detail(true) + "/facility-candidates";
  }

  StyleFacilityCandidateService.Input input() {
    return new StyleFacilityCandidateService.Input(facility);
  }

  StyleFacilityCandidateService.View add() {
    return candidates.add(org, project.id(), style.id(), input(), "workspace-reference");
  }

  long candidateAudits(String action) {
    return jdbc.sql(
            "SELECT count(*) FROM audit_event WHERE entity_type='StyleFacilityCandidate' AND"
                + " organization_id=:org AND action=:action")
        .param("org", org)
        .param("action", action)
        .query(Long.class)
        .single();
  }

  void catalogStatus(String table, UUID id, String status) {
    jdbc.sql("UPDATE " + table + " SET status=:s,version=version+1 WHERE id=:id")
        .param("id", id)
        .param("s", status)
        .update();
  }
}
