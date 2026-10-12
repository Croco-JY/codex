package com.sourceos.authorization;

import com.sourceos.identity.Actor;
import java.util.UUID;

/** Organization supplies membership facts; authorization owns the permission policy. */
public interface MembershipLookup {
  String role(Actor actor, UUID organization);
}
