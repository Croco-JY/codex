package com.sourceos.file;

import com.sourceos.authorization.ReleaseAuthorization;
import com.sourceos.authorization.ReleaseAuthorization.Authorizer;
import com.sourceos.identity.IdentityService;
import java.io.IOException;
import java.util.UUID;
import org.springframework.aop.support.AopUtils;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Only public release-content entry; callers supply no object/size/hash/callback. */
@Service
public class ReleaseContentGateway {
  public record ReleasedBinary(byte[] bytes, String displayName) {}

  private final Authorizer authorizer;
  private final BoundedObjectReader reader;
  private final IdentityService identities;

  ReleaseContentGateway(
      Authorizer authorizer, BoundedObjectReader reader, IdentityService identities) {
    if (!AopUtils.getTargetClass(reader).equals(ReleaseObjectReader.class))
      throw new IllegalStateException("Fixed File-owned bounded reader required");
    this.authorizer = authorizer;
    this.reader = reader;
    this.identities = identities;
  }

  @Transactional(propagation = Propagation.NEVER)
  public ReleasedBinary download(UUID recipient, UUID release) {
    var actor = identities.current();
    var before = authorizer.authorize(recipient, release);
    if (!actor.equals(before.actor()) || !actor.equals(identities.current()))
      throw new AccessDeniedException("Identity changed");
    byte[] bytes;
    try {
      bytes = reader.readBounded(before);
    } catch (IOException failure) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Released content unavailable");
    }
    if (!actor.equals(identities.current())) throw new AccessDeniedException("Identity changed");
    var after = authorizer.authorize(recipient, release);
    if (!actor.equals(after.actor()) || !before.candidate().equals(after.candidate()))
      throw ReleaseAuthorization.unavailable();
    // Both owner transactions have completed before any controller sees these bytes.
    return new ReleasedBinary(bytes, before.candidate().displayName());
  }
}
