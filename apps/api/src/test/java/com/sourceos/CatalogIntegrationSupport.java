package com.sourceos;

import com.sourceos.dataingestion.SourceService;
import com.sourceos.material.MaterialService;
import com.sourceos.materiallisting.ListingService;
import com.sourceos.shared.MeasurementUnit;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

abstract class CatalogIntegrationSupport extends DirectoryIntegrationSupport {
  @Autowired protected MaterialService materials;
  @Autowired protected ListingService listings;
  @Autowired protected PlatformTransactionManager manager;
  protected UUID catalogSupplier, seller;

  @BeforeEach
  void prepareCatalog() {
    catalogSupplier = supplier(JP, "Synthetic catalog " + id()).id();
    seller = supplier(CN, "Synthetic seller " + id()).id();
  }

  protected TransactionTemplate tx() {
    return new TransactionTemplate(manager);
  }

  protected MaterialService.Input materialInput(
      UUID supplier, MaterialService.Type type, MaterialService.Status status, long version) {
    return new MaterialService.Input(
        supplier,
        "article",
        type,
        "Synthetic catalog article " + id(),
        null,
        null,
        MaterialService.Completeness.UNKNOWN,
        List.of(),
        status,
        observation,
        version);
  }

  protected MaterialService.View material() {
    return materials.create(
        materialInput(
            catalogSupplier, MaterialService.Type.FABRIC, MaterialService.Status.ACTIVE, 0));
  }

  protected MaterialService.View material(MaterialService.Type type) {
    return materials.create(materialInput(catalogSupplier, type, MaterialService.Status.ACTIVE, 0));
  }

  protected MaterialService.VariantInput variantInput(UUID material, long version) {
    return new MaterialService.VariantInput(
        material,
        "catalog-sku",
        "Synthetic variant",
        null,
        null,
        null,
        null,
        MaterialService.VariantStatus.ACTIVE,
        observation,
        version);
  }

  protected MaterialService.VariantView variant(UUID material) {
    return materials.createVariant(variantInput(material, 0));
  }

  protected ListingService.Input listingInput(
      UUID material,
      BigDecimal moq,
      BigDecimal mcq,
      MeasurementUnit unit,
      ListingService.Status status,
      long version) {
    return new ListingService.Input(
        material, seller, "seller-code", moq, mcq, unit, null, null, status, observation, version);
  }

  protected ListingService.View listing(UUID material) {
    return listings.create(
        listingInput(material, null, null, null, ListingService.Status.ACTIVE, 0));
  }

  protected UUID fiber(String code) {
    return jdbc.sql("SELECT id FROM fiber_type WHERE code=:code")
        .param("code", code)
        .query(UUID.class)
        .single();
  }

  protected UUID external(SourceService.RecordKind kind, String key) {
    return sources.record(new SourceService.RecordInput(source, kind, key)).id();
  }
}
