package com.sourceos.supplier;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface SupplierRepository extends JpaRepository<SupplierEntity, UUID> {}
