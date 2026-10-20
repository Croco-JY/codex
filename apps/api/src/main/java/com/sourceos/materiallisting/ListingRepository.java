package com.sourceos.materiallisting;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface ListingRepository extends JpaRepository<ListingEntity, UUID> {}
