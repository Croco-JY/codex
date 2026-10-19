package com.sourceos.file;

import com.sourceos.authorization.OrganizationAuthorization;
import java.io.IOException;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class AuthorizedStorage {
  private final StoragePort storage;
  private final OrganizationAuthorization authorization;

  public AuthorizedStorage(StoragePort storage, OrganizationAuthorization authorization) {
    this.storage = storage;
    this.authorization = authorization;
  }

  public UUID put(UUID org, byte[] bytes) throws IOException {
    authorization.requireWrite(org);
    if (bytes.length > 10 * 1024 * 1024) throw new IllegalArgumentException("File too large");
    UUID object = UUID.randomUUID();
    storage.put(org, object, bytes);
    return object;
  }

  public byte[] get(UUID org, UUID object) throws IOException {
    authorization.requireRead(org);
    return storage.get(org, object);
  }
}
