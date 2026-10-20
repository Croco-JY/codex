package com.sourceos.material;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface MaterialRepository extends JpaRepository<MaterialEntity, UUID> {}
