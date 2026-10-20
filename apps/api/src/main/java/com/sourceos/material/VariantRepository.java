package com.sourceos.material;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface VariantRepository extends JpaRepository<VariantEntity, UUID> {}
