package com.sourceos.file;

import com.sourceos.authorization.ReleaseAuthorization.Binding;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component("releaseObjectReader")
final class ReleaseObjectReader implements BoundedObjectReader {
  private final LocalStorageAdapter local;

  ReleaseObjectReader(@Value("${source.storage-root}") String root) throws IOException {
    // The same local adapter and configured namespace; independent of the legacy
    // StoragePort bean so existing source-storage clients retain their contract.
    local = new LocalStorageAdapter(root);
  }

  @Override
  public byte[] readBounded(Binding binding) throws IOException {
    return local.readBounded(binding);
  }
}
