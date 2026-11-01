package com.sourceos;

import com.sourceos.authorization.ReleaseAuthorization.Authorizer;
import com.sourceos.file.ReleaseContentGateway;
import com.sourceos.pattern.*;
import com.sourceos.patternrelease.*;
import com.sourceos.patternrelease.ReleaseModels.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.*;

/** Actual production adapter, services, private gateway and isolated PostgreSQL. */
public abstract class PatternReleaseIntegrationSupport extends PatternSupport {
  @Autowired protected PatternArtifactService artifacts;
  @Autowired protected PatternReleaseService releases;
  @Autowired protected ReleaseConsentService consents;
  @Autowired protected ReleaseContentGateway gateway;
  @Autowired protected Authorizer authorizer;

  @Autowired
  @Qualifier("dataSource")
  protected DataSource dataSource;

  protected PatternService.View family;
  protected PatternArtifactService.Result ready;
  protected ConsentView receivingConsent;
  protected SourceView grant;

  protected static byte[] pdfBytes() {
    return "%PDF-1.4\nsource-os synthetic release\n%%EOF\n".getBytes(StandardCharsets.US_ASCII);
  }

  @BeforeEach
  void realReleaseFixture() {
    actor(owner);
    family = pattern();
    ready =
        artifacts.upload(
            org,
            project.id(),
            style.id(),
            family.id(),
            new PatternArtifactService.Input(
                1L,
                "Exact released revision",
                "Purpose",
                null,
                PatternArtifactProbe.Format.PDF,
                "검토 Pattern.pdf"),
            () -> new ByteArrayInputStream(pdfBytes()),
            "release-real-upload");
    actor(foreignOwner);
    receivingConsent = consents.issue(foreignOrg, new ConsentCreateInput(org), "real-consent");
    actor(owner);
    grant =
        releases.create(
            org,
            project.id(),
            style.id(),
            family.id(),
            ready.revision().id(),
            new CreateInput(receivingConsent.id(), 1L, "Inspect this exact artifact", 86400),
            "real-release");
    actor(foreignOwner);
  }

  protected UUID releaseId() {
    return grant.release().id();
  }

  protected UUID objectId() {
    return jdbc.sql("SELECT storage_object_id FROM pattern_release WHERE id=:id")
        .param("id", releaseId())
        .query(UUID.class)
        .single();
  }

  protected Path objectPath() {
    return Path.of("/tmp/source-supply-test-storage", org.toString(), objectId().toString());
  }

  protected String recipientPath() {
    return "/api/v1/organizations/" + foreignOrg + "/received-pattern-releases/" + releaseId();
  }

  protected Connection independentConnection() throws SQLException {
    return DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
  }

  protected void revoke() {
    actor(owner);
    releases.revoke(
        org,
        project.id(),
        style.id(),
        family.id(),
        ready.revision().id(),
        releaseId(),
        new EventCommand(1L),
        "held-revoke");
  }

  protected void withdraw() {
    actor(foreignOwner);
    consents.withdraw(foreignOrg, receivingConsent.id(), new EventCommand(2L), "held-withdraw");
  }
}
