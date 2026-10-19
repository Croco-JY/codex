package com.sourceos.file;

import java.io.IOException;
import java.util.UUID;

public interface StoragePort {
  void put(UUID organization, UUID object, byte[] bytes) throws IOException;

  byte[] get(UUID organization, UUID object) throws IOException;
}
