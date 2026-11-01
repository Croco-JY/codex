package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.patternrelease.ReleaseModels.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class PatternReleaseGatewayTest extends PatternReleaseIntegrationSupport {
  @org.springframework.beans.factory.annotation.Autowired
  com.sourceos.file.AuthorizedStorage sourceStorage;

  @Test
  void actualPrivateFileWithRecipientMembershipOnlyAndViewerDownload() {
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM membership WHERE organization_id=:source AND"
                        + " subject=:recipient")
                .param("source", org)
                .param("recipient", foreignOwner)
                .query(Long.class)
                .single())
        .isZero();
    assertThat(gateway.download(foreignOrg, releaseId()).bytes()).containsExactly(pdfBytes());
    String viewer = "release-real-viewer-" + id();
    membership(foreignOrg, viewer, "VIEWER", "ACTIVE");
    actor(viewer);
    assertThat(gateway.download(foreignOrg, releaseId()).bytes()).containsExactly(pdfBytes());
    actor(owner);
    assertThatThrownBy(() -> gateway.download(foreignOrg, releaseId()))
        .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    actor(foreignOwner);
    assertThatThrownBy(() -> transaction().execute(t -> gateway.download(foreignOrg, releaseId())))
        .isInstanceOf(org.springframework.transaction.IllegalTransactionStateException.class);
  }

  @Test
  void existingAuthorizedStorageStillRejectsRecipientAndGuessingNeverGrants() {
    assertThatThrownBy(() -> sourceStorage.get(org, objectId()))
        .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    assertThatThrownBy(() -> gateway.download(foreignOrg, id()))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    actor("nonmember-" + id());
    assertThatThrownBy(() -> gateway.download(foreignOrg, releaseId()))
        .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
  }

  @ParameterizedTest
  @ValueSource(strings = {"source", "recipient", "project", "style", "pattern"})
  void everyParentVersionFenceDeniesAndArchiveReactivationDoesNotResurrect(String parent) {
    if (parent.equals("pattern")) {
      actor(owner);
      patterns.lifecycle(
          org,
          project.id(),
          style.id(),
          family.id(),
          new com.sourceos.pattern.PatternService.LifecycleInput(
              com.sourceos.pattern.PatternService.Status.ARCHIVED, 0L),
          "fence-archive");
      patterns.lifecycle(
          org,
          project.id(),
          style.id(),
          family.id(),
          new com.sourceos.pattern.PatternService.LifecycleInput(
              com.sourceos.pattern.PatternService.Status.ACTIVE, 1L),
          "fence-reactivate");
    } else {
      String table =
          parent.equals("source") || parent.equals("recipient") ? "organization" : parent;
      UUID id =
          parent.equals("source")
              ? org
              : parent.equals("recipient")
                  ? foreignOrg
                  : parent.equals("project") ? project.id() : style.id();
      jdbc.sql("UPDATE " + table + " SET name=name||' edited',version=version+1 WHERE id=:id")
          .param("id", id)
          .update();
    }
    actor(foreignOwner);
    assertThatThrownBy(() -> gateway.download(foreignOrg, releaseId()))
        .isInstanceOfSatisfying(
            org.springframework.web.server.ResponseStatusException.class,
            e -> assertThat(e.getStatusCode().value()).isEqualTo(404));
    assertThat(authorizer.inspectRecipient(foreignOrg, releaseId()).effectiveState())
        .isEqualTo("UNAVAILABLE");
  }

  @ParameterizedTest
  @ValueSource(strings = {"revoke", "withdraw", "membership"})
  void currentDenialsPreserveImmutableReceipt(String kind) {
    if (kind.equals("revoke")) revoke();
    else if (kind.equals("withdraw")) withdraw();
    else
      jdbc.sql(
              "UPDATE membership SET status='REVOKED' WHERE organization_id=:org AND"
                  + " subject=:subject")
          .param("org", foreignOrg)
          .param("subject", foreignOwner)
          .update();
    actor(foreignOwner);
    assertThatThrownBy(() -> gateway.download(foreignOrg, releaseId()))
        .isInstanceOf(RuntimeException.class);
    assertThat(
            jdbc.sql("SELECT pattern_revision_id FROM pattern_release WHERE id=:id")
                .param("id", releaseId())
                .query(UUID.class)
                .single())
        .isEqualTo(ready.revision().id());
  }
}
