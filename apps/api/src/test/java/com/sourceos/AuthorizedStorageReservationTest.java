package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.file.AuthorizedStorage;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.AccessDeniedException;

class AuthorizedStorageReservationTest extends WorkspaceIntegrationSupport {
  @Autowired AuthorizedStorage storage;

  @Test
  void providedIdentityCreateOnlyCapAuthorizationAndExistingCompatibility() throws Exception {
    var object = id();
    byte[] bytes = {1, 2, 3};
    storage.putNew(org, object, bytes);
    assertThat(storage.get(org, object)).isEqualTo(bytes);
    assertThatThrownBy(() -> storage.putNew(org, object, new byte[] {4}))
        .isInstanceOf(IOException.class);
    assertThat(storage.get(org, object)).isEqualTo(bytes);
    assertThat(storage.get(org, storage.put(org, bytes))).isEqualTo(bytes);
    var max = id();
    storage.putNew(org, max, new byte[AuthorizedStorage.MAX_BYTES]);
    assertThat(storage.get(org, max)).hasSize(10485760);
    assertThatThrownBy(() -> storage.putNew(org, id(), new byte[AuthorizedStorage.MAX_BYTES + 1]))
        .isInstanceOf(IllegalArgumentException.class);
    actor(foreignOwner);
    assertThatThrownBy(() -> storage.get(org, object)).isInstanceOf(AccessDeniedException.class);
    assertThatThrownBy(() -> storage.putNew(org, id(), bytes))
        .isInstanceOf(AccessDeniedException.class);
    var other = id();
    storage.putNew(foreignOrg, object, new byte[] {9});
    assertThat(storage.get(foreignOrg, object)).containsExactly((byte) 9);
    actor(owner);
    assertThat(storage.get(org, object)).isEqualTo(bytes);
    jdbc.sql("UPDATE membership SET status='REVOKED' WHERE organization_id=:org")
        .param("org", org)
        .update();
    assertThatThrownBy(() -> storage.putNew(org, other, bytes))
        .isInstanceOf(AccessDeniedException.class);
  }
}
