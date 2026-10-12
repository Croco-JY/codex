package com.sourceos.authorization;

import com.sourceos.identity.IdentityService;
import java.util.*;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

@Service
public class OrganizationAuthorization {
  private final IdentityService identities;
  private final MembershipLookup memberships;

  public OrganizationAuthorization(IdentityService identities, MembershipLookup memberships) {
    this.identities = identities;
    this.memberships = memberships;
  }

  public String requireRead(UUID org) {
    return require(org, false);
  }

  public String requireWrite(UUID org) {
    return require(org, true);
  }

  private String require(UUID org, boolean write) {
    String role = memberships.role(identities.current(), org);
    if (role == null || (write && !Set.of("ORG_OWNER", "ORG_ADMIN").contains(role)))
      throw new AccessDeniedException("Access denied");
    return role;
  }
}
