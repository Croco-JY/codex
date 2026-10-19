package com.sourceos.organization;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "organization")
class OrganizationEntity {
  @Id UUID id;

  @Column(nullable = false, length = 160)
  String name;

  @Column(nullable = false, length = 20)
  String status;

  @Version long version;

  @Column(name = "created_at", nullable = false)
  Instant createdAt;

  protected OrganizationEntity() {}

  OrganizationEntity(UUID id, String name) {
    this.id = id;
    this.name = name;
    this.status = "ACTIVE";
    this.createdAt = Instant.now();
  }
}
