package com.sourceos.file;

import com.sourceos.authorization.OrganizationAuthorization;
import java.io.IOException;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class AuthorizedStorage {
  public static final int MAX_BYTES = 10 * 1024 * 1024;

  private final StoragePort storage;
  private final OrganizationAuthorization authorization;

  public AuthorizedStorage(StoragePort storage, OrganizationAuthorization authorization) {
    this.storage = storage;
    this.authorization = authorization;
  }

  public UUID put(UUID org, byte[] bytes) throws IOException {
    UUID object = UUID.randomUUID();
    putNew(org, object, bytes);
    return object;
  }

  /** Create-only write using an identity already reserved by the caller. */
  public void putNew(UUID org, UUID serverObjectId, byte[] bytes) throws IOException {
    authorization.requireWrite(org);
    if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("File too large");
    storage.put(org, serverObjectId, bytes);
  }

  public byte[] get(UUID org, UUID object) throws IOException {
    authorization.requireRead(org);
    return storage.get(org, object);
  }
}
