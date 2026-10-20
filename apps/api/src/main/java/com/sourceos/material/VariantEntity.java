package com.sourceos.material;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "material_variant")
class VariantEntity {
  @Id
  @Column(name = "id")
  UUID id;

  @Column(name = "material_id")
  UUID materialId;

  @Column(name = "catalog_variant_sku")
  String catalogVariantSku;

  @Column(name = "variant_name")
  String variantName;

  @Column(name = "color_name")
  String colorName;

  @Column(name = "color_code")
  String colorCode;

  @Column(name = "batch_number")
  String batchNumber;

  @Column(name = "status")
  String status;

  @Version long version;

  @Column(name = "created_at")
  Instant createdAt;

  @Column(name = "updated_at")
  Instant updatedAt;

  protected VariantEntity() {}
}
