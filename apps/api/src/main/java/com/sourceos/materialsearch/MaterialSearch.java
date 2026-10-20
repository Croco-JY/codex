package com.sourceos.materialsearch;

import com.sourceos.material.MaterialService;
import com.sourceos.materiallisting.ListingService;
import com.sourceos.materialprice.PriceService;
import com.sourceos.shared.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** PostgreSQL read projection; no access to other modules' entities or repositories. */
@Service
public class MaterialSearch {
  public record Filters(
      MaterialService.Type materialType,
      UUID catalogSupplierId,
      UUID originCountryId,
      UUID fiberTypeId,
      BigDecimal minFiberPercentage,
      BigDecimal maxFiberPercentage,
      BigDecimal minGsm,
      BigDecimal maxGsm,
      BigDecimal minWidthMm,
      BigDecimal maxWidthMm,
      BigDecimal minThicknessMm,
      BigDecimal maxThicknessMm,
      String q,
      String color,
      UUID variantId,
      MaterialService.Status status,
      UUID sellerSupplierId,
      BigDecimal maxMoq,
      BigDecimal maxMcq,
      MeasurementUnit quantityUnit,
      Integer minLeadTimeDays,
      Integer maxLeadTimeDays,
      ListingService.Status listingStatus,
      BigDecimal maxPrice,
      UUID priceDataSourceId,
      String currency,
      MeasurementUnit priceUnit,
      Instant asOf,
      BigDecimal requestedQuantity,
      Boolean allowMaterialFallback) {
    public Filters {
      allowMaterialFallback = Boolean.TRUE.equals(allowMaterialFallback);
      q = q == null ? null : SearchText.normalize(q);
      color = color == null ? null : SearchText.normalize(color);
    }

    public Filters withCatalogSupplier(UUID id) {
      return new Filters(
          materialType,
          id,
          originCountryId,
          fiberTypeId,
          minFiberPercentage,
          maxFiberPercentage,
          minGsm,
          maxGsm,
          minWidthMm,
          maxWidthMm,
          minThicknessMm,
          maxThicknessMm,
          q,
          color,
          variantId,
          status,
          sellerSupplierId,
          maxMoq,
          maxMcq,
          quantityUnit,
          minLeadTimeDays,
          maxLeadTimeDays,
          listingStatus,
          maxPrice,
          priceDataSourceId,
          currency,
          priceUnit,
          asOf,
          requestedQuantity,
          allowMaterialFallback);
    }
  }

  private final JdbcClient jdbc;
  private final MaterialService materials;

  public MaterialSearch(JdbcClient jdbc, MaterialService materials) {
    this.jdbc = jdbc;
    this.materials = materials;
  }

  private static void range(BigDecimal lo, BigDecimal hi) {
    DecimalValues.quantity(lo, true);
    DecimalValues.quantity(hi, true);
    if (lo != null && hi != null && lo.compareTo(hi) > 0)
      throw ValidationRules.bad("Invalid search range");
  }

  private static void add(
      StringBuilder sql, Map<String, Object> p, String condition, String name, Object value) {
    if (value != null) {
      sql.append(" AND ").append(condition);
      p.put(name, value instanceof Enum<?> e ? e.name() : value);
    }
  }

  private static void addColor(StringBuilder sql, Map<String, Object> p, String color) {
    // Search projection only: leave stored color/code and external identities unchanged.
    add(
        sql,
        p,
        "(strpos(lower(btrim(normalize(coalesce(v.color_name,''),NFKC))),:color)>0 OR"
            + " strpos(lower(btrim(normalize(coalesce(v.color_code,''),NFKC))),:color)>0)",
        "color",
        color);
  }

  @Transactional(readOnly = true)
  public Keysets.Page<MaterialService.View> search(Filters f, int limit, String cursor) {
    range(f.minFiberPercentage(), f.maxFiberPercentage());
    range(f.minGsm(), f.maxGsm());
    range(f.minWidthMm(), f.maxWidthMm());
    range(f.minThicknessMm(), f.maxThicknessMm());
    DecimalValues.quantity(f.maxMoq(), true);
    DecimalValues.quantity(f.maxMcq(), true);
    DecimalValues.quantity(f.maxPrice(), false);
    DecimalValues.quantity(f.requestedQuantity(), false);
    if ((f.minFiberPercentage() != null || f.maxFiberPercentage() != null)
        && f.fiberTypeId() == null)
      throw ValidationRules.bad("Fiber required for percentage filter");
    if ((f.minFiberPercentage() != null
            && f.minFiberPercentage().compareTo(new BigDecimal("100")) > 0)
        || (f.maxFiberPercentage() != null
            && f.maxFiberPercentage().compareTo(new BigDecimal("100")) > 0))
      throw ValidationRules.bad("Fiber percentage out of range");
    if ((f.minLeadTimeDays() != null && f.minLeadTimeDays() < 0)
        || (f.maxLeadTimeDays() != null && f.maxLeadTimeDays() < 0)
        || (f.minLeadTimeDays() != null
            && f.maxLeadTimeDays() != null
            && f.minLeadTimeDays() > f.maxLeadTimeDays()))
      throw ValidationRules.bad("Invalid lead time range");
    if ((f.q() != null && f.q().length() > 200) || (f.color() != null && f.color().length() > 100))
      throw ValidationRules.bad("Search text too long");
    boolean price = f.maxPrice() != null;
    if (price) {
      if (f.priceDataSourceId() == null
          || f.currency() == null
          || f.priceUnit() == null
          || f.asOf() == null)
        throw ValidationRules.bad(
            "Price filter requires provider, currency, unit and explicit asOf");
      PriceService.currency(f.currency());
    } else if (f.priceDataSourceId() != null
        || f.currency() != null
        || f.priceUnit() != null
        || f.asOf() != null
        || f.requestedQuantity() != null
        || f.allowMaterialFallback()) throw ValidationRules.bad("Price scope requires maxPrice");
    if (f.variantId() != null) materials.variant(f.variantId());
    var anchor = Keysets.anchor(cursor, f, limit);
    Map<String, Object> p = new HashMap<>();
    StringBuilder sql =
        new StringBuilder(
            "SELECT m.id FROM material m LEFT JOIN fabric_spec fs ON fs.material_id=m.id LEFT JOIN"
                + " leather_spec ls ON ls.material_id=m.id WHERE true");
    add(sql, p, "m.material_type=:type", "type", f.materialType());
    add(sql, p, "m.catalog_supplier_id=:catalog", "catalog", f.catalogSupplierId());
    add(sql, p, "m.origin_country_id=:origin", "origin", f.originCountryId());
    add(sql, p, "m.status=:status", "status", f.status());
    add(
        sql,
        p,
        "(strpos(m.normalized_name,:q)>0 OR"
            + " strpos(lower(btrim(normalize(coalesce(m.catalog_article_number,''),NFKC))),:q)>0)",
        "q",
        f.q());
    add(sql, p, "fs.gsm>=:minGsm", "minGsm", f.minGsm());
    add(sql, p, "fs.gsm<=:maxGsm", "maxGsm", f.maxGsm());
    add(sql, p, "fs.width_mm>=:minWidth", "minWidth", f.minWidthMm());
    add(sql, p, "fs.width_mm<=:maxWidth", "maxWidth", f.maxWidthMm());
    add(
        sql,
        p,
        "coalesce(fs.thickness_mm,ls.thickness_min_mm)>=:minThickness",
        "minThickness",
        f.minThicknessMm());
    add(
        sql,
        p,
        "coalesce(fs.thickness_mm,ls.thickness_max_mm)<=:maxThickness",
        "maxThickness",
        f.maxThicknessMm());
    if (f.fiberTypeId() != null) {
      sql.append(
          " AND EXISTS(SELECT 1 FROM material_composition c WHERE c.material_id=m.id AND"
              + " c.fiber_type_id=:fiber");
      p.put("fiber", f.fiberTypeId());
      add(sql, p, "c.percentage>=:minFiber", "minFiber", f.minFiberPercentage());
      add(sql, p, "c.percentage<=:maxFiber", "maxFiber", f.maxFiberPercentage());
      sql.append(")");
    }
    boolean colorPrice = price && f.color() != null && f.variantId() == null;
    if (!colorPrice && (f.variantId() != null || f.color() != null)) {
      sql.append(" AND EXISTS(SELECT 1 FROM material_variant v WHERE v.material_id=m.id");
      add(sql, p, "v.id=:variantFilter", "variantFilter", f.variantId());
      addColor(sql, p, f.color());
      sql.append(")");
    }
    boolean commercial =
        f.sellerSupplierId() != null
            || f.maxMoq() != null
            || f.maxMcq() != null
            || f.quantityUnit() != null
            || f.minLeadTimeDays() != null
            || f.maxLeadTimeDays() != null
            || f.listingStatus() != null
            || price;
    if (commercial) {
      sql.append(" AND EXISTS(SELECT 1 FROM supplier_material_listing l WHERE l.material_id=m.id");
      add(sql, p, "l.seller_supplier_id=:seller", "seller", f.sellerSupplierId());
      add(sql, p, "l.minimum_order_quantity<=:maxMoq", "maxMoq", f.maxMoq());
      add(sql, p, "l.minimum_color_quantity<=:maxMcq", "maxMcq", f.maxMcq());
      add(sql, p, "l.quantity_unit=:quantityUnit", "quantityUnit", f.quantityUnit());
      add(sql, p, "l.standard_lead_time_days>=:minLead", "minLead", f.minLeadTimeDays());
      add(sql, p, "l.standard_lead_time_days<=:maxLead", "maxLead", f.maxLeadTimeDays());
      add(sql, p, "l.status=:listingStatus", "listingStatus", f.listingStatus());
      if (price) {
        // Color-only requests test every matching variant inside this same Listing.
        // The expression is one of two fixed SQL contexts, never caller-supplied SQL.
        if (colorPrice) {
          sql.append(" AND EXISTS(SELECT 1 FROM material_variant v WHERE v.material_id=m.id");
          addColor(sql, p, f.color());
        }
        String variant = colorPrice ? "v.id" : "CAST(:priceVariant AS uuid)";
        sql.append(" ");
        sql.append(
            """
            AND (SELECT p.amount FROM material_price p WHERE p.listing_id=l.id
            AND p.data_source_id=:priceSource AND p.currency=:priceCurrency AND p.price_unit=:priceUnit
            AND p.valid_from<=:asOf AND (p.valid_to IS NULL OR p.valid_to>:asOf)
            AND ((%1$s IS NULL AND p.material_variant_id IS NULL) OR (%1$s IS NOT NULL AND (p.material_variant_id=%1$s OR (:fallback AND p.material_variant_id IS NULL))))
            AND (p.minimum_order_quantity IS NULL OR (CAST(:quantity AS numeric) IS NOT NULL AND p.minimum_order_quantity<=:quantity))
            ORDER BY CASE WHEN p.material_variant_id IS NOT DISTINCT FROM %1$s THEN 0 ELSE 1 END,p.minimum_order_quantity DESC NULLS LAST,p.valid_from DESC,p.observed_at DESC,p.created_at DESC,p.id DESC LIMIT 1)<=:maxPrice
            """
                .formatted(variant));
        if (colorPrice) sql.append(")");
        p.put("priceSource", f.priceDataSourceId());
        p.put("priceCurrency", f.currency());
        p.put("priceUnit", f.priceUnit().name());
        p.put("asOf", Keysets.time(f.asOf()));
        p.put("priceVariant", f.variantId());
        p.put("fallback", f.allowMaterialFallback());
        p.put("quantity", f.requestedQuantity());
        p.put("maxPrice", f.maxPrice());
      }
      sql.append(")");
    }
    if (anchor.at() != null) {
      sql.append(" AND (m.created_at,m.id)<(:anchorAt,:anchorId)");
      p.put("anchorAt", Keysets.time(anchor.at()));
      p.put("anchorId", anchor.id());
    }
    sql.append(" ORDER BY m.created_at DESC,m.id DESC LIMIT :limit");
    p.put("limit", limit + 1);
    var rows =
        jdbc.sql(sql.toString()).params(p).query(UUID.class).list().stream()
            .map(materials::read)
            .toList();
    return Keysets.page(rows, limit, f, MaterialService.View::createdAt, MaterialService.View::id);
  }
}
