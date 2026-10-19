package com.sourceos.facility;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface FacilityRepository extends JpaRepository<FacilityEntity, UUID> {}
