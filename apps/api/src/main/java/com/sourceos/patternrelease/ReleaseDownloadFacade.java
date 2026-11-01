package com.sourceos.patternrelease;

import com.sourceos.file.ReleaseContentGateway;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class ReleaseDownloadFacade {
  private final ReleaseContentGateway files;

  public ReleaseDownloadFacade(ReleaseContentGateway files) {
    this.files = files;
  }

  @Transactional(propagation = Propagation.NEVER)
  public ReleaseContentGateway.ReleasedBinary download(UUID recipient, UUID release) {
    return files.download(recipient, release);
  }
}
