package com.sourceos.organization;

import java.util.UUID;

public record OrganizationView(UUID id, String name, String status, long version, String role) {}
