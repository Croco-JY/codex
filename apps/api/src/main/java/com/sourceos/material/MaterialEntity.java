package com.sourceos.material;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "material")
class MaterialEntity {
  @Id
  @Column(name = "id")
  UUID id;

  @Column(name = "catalog_supplier_id")
  UUID catalogSupplierId;

  @Column(name = "catalog_article_number")
  String catalogArticleNumber;

  @Column(name = "material_type")
  String materialType;

  @Column(name = "display_name")
  String displayName;

  @Column(name = "normalized_name")
  String normalizedName;

  @Column(name = "description")
  String description;

  @Column(name = "origin_country_id")
  UUID originCountryId;

  @Column(name = "composition_completeness")
  String compositionCompleteness;

  @Column(name = "status")
  String status;

  @Version long version;

  @Column(name = "created_at")
  Instant createdAt;

  @Column(name = "updated_at")
  Instant updatedAt;

  protected MaterialEntity() {}
}
