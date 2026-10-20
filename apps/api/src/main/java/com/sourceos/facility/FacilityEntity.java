package com.sourceos.facility;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "facility")
class FacilityEntity {
  @Id UUID id;

  @Column(name = "supplier_id", nullable = false)
  UUID supplierId;

  @Column(name = "facility_type", nullable = false, length = 30)
  String facilityType;

  @Column(nullable = false, length = 160)
  String name;

  @Column(name = "country_id", nullable = false)
  UUID countryId;

  @Column(name = "region_id")
  UUID regionId;

  @Column(name = "industrial_cluster_id")
  UUID industrialClusterId;

  @Column(name = "address_line_1", length = 300)
  String addressLine1;

  @Column(name = "address_line_2", length = 300)
  String addressLine2;

  @Column(name = "postal_code", length = 30)
  String postalCode;

  @Column(precision = 9, scale = 6)
  BigDecimal latitude;

  @Column(precision = 10, scale = 6)
  BigDecimal longitude;

  @Column(length = 80)
  String phone;

  @Column(length = 254)
  String email;

  @Column(nullable = false, length = 20)
  String status;

  @Version long version;

  @Column(name = "created_at", nullable = false)
  Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  Instant updatedAt;

  protected FacilityEntity() {}
}
