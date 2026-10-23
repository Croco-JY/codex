package com.sourceos;

import com.sourceos.material.MaterialService;
import com.sourceos.materiallisting.ListingService;
import com.sourceos.stylematerialselection.StyleMaterialSelectionService;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;

abstract class StyleMaterialSelectionSupport extends WorkspaceIntegrationSupport {
  @Autowired protected StyleMaterialSelectionService selections;
  @Autowired protected MaterialService materials;
  @Autowired protected ListingService listings;
  protected UUID material, variant, listing, otherMaterial, otherVariant, otherListing;

  @BeforeEach
  void catalogFixture() {
    UUID country = jdbc.sql("SELECT id FROM country WHERE alpha2='KR'").query(UUID.class).single();
    UUID supplier = id(), seller = id();
    for (UUID s : List.of(supplier, seller))
      jdbc.sql(
              "INSERT INTO supplier_profile(id,country_id,display_name,normalized_name)"
                  + " VALUES(:id,:country,'Synthetic supplier','synthetic')")
          .param("id", s)
          .param("country", country)
          .update();
    material = catalog(supplier);
    otherMaterial = catalog(supplier);
    variant = variant(material);
    otherVariant = variant(otherMaterial);
    listing = listing(material, seller);
    otherListing = listing(otherMaterial, seller);
  }

  UUID catalog(UUID supplier) {
    var id = id();
    jdbc.sql(
            "INSERT INTO"
                + " material(id,catalog_supplier_id,material_type,display_name,normalized_name,status)"
                + " VALUES(:id,:s,'FABRIC','Synthetic selectable fabric','synthetic','ACTIVE')")
        .param("id", id)
        .param("s", supplier)
        .update();
    return id;
  }

  UUID variant(UUID material) {
    var id = id();
    jdbc.sql(
            "INSERT INTO material_variant(id,material_id,variant_name) VALUES(:id,:m,'Synthetic"
                + " variant')")
        .param("id", id)
        .param("m", material)
        .update();
    return id;
  }

  UUID listing(UUID material, UUID seller) {
    var id = id();
    jdbc.sql(
            "INSERT INTO"
                + " supplier_material_listing(id,material_id,seller_supplier_id,seller_article_number)"
                + " VALUES(:id,:m,:s,'Synthetic seller article')")
        .param("id", id)
        .param("m", material)
        .param("s", seller)
        .update();
    return id;
  }

  String path() {
    return detail(true) + "/material-selections";
  }

  StyleMaterialSelectionService.Input input(boolean v, boolean l) {
    return new StyleMaterialSelectionService.Input(
        material, v ? variant : null, l ? listing : null);
  }

  StyleMaterialSelectionService.View add(boolean v, boolean l) {
    return selections.add(org, project.id(), style.id(), input(v, l), "workspace-reference");
  }

  long selectionAudits(String action) {
    return jdbc.sql(
            "SELECT count(*) FROM audit_event WHERE entity_type='StyleMaterialSelection' AND"
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
