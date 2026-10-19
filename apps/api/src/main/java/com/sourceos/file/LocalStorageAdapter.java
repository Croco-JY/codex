package com.sourceos.file;

import java.io.IOException;
import java.nio.file.*;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class LocalStorageAdapter implements StoragePort {
  private final Path root;

  LocalStorageAdapter(@Value("${source.storage-root}") String root) throws IOException {
    this.root = Path.of(root).toAbsolutePath().normalize();
    Files.createDirectories(this.root);
  }

  private Path path(UUID org, UUID object) throws IOException {
    Path dir = root.resolve(org.toString());
    Files.createDirectories(dir);
    if (Files.isSymbolicLink(root) || Files.isSymbolicLink(dir))
      throw new IOException("Unsafe storage path");
    Path p = dir.resolve(object.toString());
    if (Files.isSymbolicLink(p)) throw new IOException("Unsafe storage path");
    return p;
  }

  public void put(UUID org, UUID object, byte[] bytes) throws IOException {
    Files.write(path(org, object), bytes, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
  }

  public byte[] get(UUID org, UUID object) throws IOException {
    return Files.readAllBytes(path(org, object));
  }
}
