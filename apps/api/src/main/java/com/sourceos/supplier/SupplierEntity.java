package com.sourceos.supplier;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "supplier_profile")
class SupplierEntity {
  @Id UUID id;

  @Column(name = "country_id", nullable = false)
  UUID countryId;

  @Column(name = "display_name", nullable = false, length = 160)
  String displayName;

  @Column(name = "normalized_name", nullable = false, length = 320)
  String normalizedName;

  @Column(name = "legal_name", length = 160)
  String legalName;

  @Column(name = "native_name", length = 160)
  String nativeName;

  @Column(name = "english_name", length = 160)
  String englishName;

  @Column(name = "business_registration_number", length = 100)
  String businessRegistrationNumber;

  @Column(name = "website_url", length = 2000)
  String websiteUrl;

  @Column(length = 4000)
  String description;

  @Column(name = "verification_status", nullable = false, length = 30)
  String verificationStatus;

  @Column(nullable = false, length = 20)
  String status;

  @Version long version;

  @Column(name = "created_at", nullable = false)
  Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  Instant updatedAt;

  protected SupplierEntity() {}
}
