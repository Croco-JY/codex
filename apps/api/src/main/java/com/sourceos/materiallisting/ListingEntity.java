package com.sourceos.materiallisting;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "supplier_material_listing")
class ListingEntity {
  @Id
  @Column(name = "id")
  UUID id;

  @Column(name = "material_id")
  UUID materialId;

  @Column(name = "seller_supplier_id")
  UUID sellerSupplierId;

  @Column(name = "seller_article_number")
  String sellerArticleNumber;

  @Column(name = "minimum_order_quantity", precision = 19, scale = 4)
  BigDecimal minimumOrderQuantity;

  @Column(name = "minimum_color_quantity", precision = 19, scale = 4)
  BigDecimal minimumColorQuantity;

  @Column(name = "quantity_unit")
  String quantityUnit;

  @Column(name = "standard_lead_time_days")
  Integer standardLeadTimeDays;

  @Column(name = "reproduction_lead_time_days")
  Integer reproductionLeadTimeDays;

  @Column(name = "status")
  String status;

  @Version long version;

  @Column(name = "created_at")
  Instant createdAt;

  @Column(name = "updated_at")
  Instant updatedAt;

  protected ListingEntity() {}
}
