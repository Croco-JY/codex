package com.sourceos.organization;

import com.sourceos.audit.AuditRecorder;
import com.sourceos.identity.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class OrganizationService {
  private final OrganizationRepository repository;
  private final JdbcClient jdbc;
  private final IdentityService identities;
  private final com.sourceos.authorization.OrganizationAuthorization authorization;
  private final AuditRecorder audit;

  public OrganizationService(
      OrganizationRepository repository,
      JdbcClient jdbc,
      IdentityService identities,
      com.sourceos.authorization.OrganizationAuthorization authorization,
      AuditRecorder audit) {
    this.repository = repository;
    this.jdbc = jdbc;
    this.identities = identities;
    this.authorization = authorization;
    this.audit = audit;
  }

  @Transactional
  public OrganizationView create(String name, String requestId) {
    Actor actor = identities.current();
    var entity = repository.saveAndFlush(new OrganizationEntity(UUID.randomUUID(), name.trim()));
    jdbc.sql(
            "INSERT INTO membership(id,organization_id,issuer,subject,role)"
                + " VALUES(:id,:org,:issuer,:subject,'ORG_OWNER')")
        .param("id", UUID.randomUUID())
        .param("org", entity.id)
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .update();
    audit.record(actor, entity.id, "organization.created", requestId);
    return view(entity, "ORG_OWNER");
  }

  @Transactional(readOnly = true)
  public List<OrganizationView> list() {
    Actor actor = identities.current();
    return jdbc.sql(
            "SELECT o.id,o.name,o.status,o.version,m.role FROM organization o JOIN membership m ON"
                + " m.organization_id=o.id WHERE m.issuer=:issuer AND m.subject=:subject AND"
                + " m.status='ACTIVE' AND o.status='ACTIVE' ORDER BY o.created_at,o.id")
        .param("issuer", actor.issuer())
        .param("subject", actor.subject())
        .query(
            (rs, n) ->
                new OrganizationView(
                    rs.getObject("id", UUID.class),
                    rs.getString("name"),
                    rs.getString("status"),
                    rs.getLong("version"),
                    rs.getString("role")))
        .list();
  }

  @Transactional(readOnly = true)
  public OrganizationView read(UUID id) {
    String role = authorization.requireRead(id);
    return view(
        repository.findById(id).orElseThrow(() -> new AccessDeniedException("Access denied")),
        role);
  }

  @Transactional
  public OrganizationView rename(UUID id, String name, long version, String requestId) {
    Actor actor = identities.current();
    String role = authorization.requireWrite(id);
    var entity =
        repository.findById(id).orElseThrow(() -> new AccessDeniedException("Access denied"));
    if (entity.version != version)
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "Organization changed; refresh and retry");
    entity.name = name.trim();
    repository.flush();
    audit.record(actor, id, "organization.renamed", requestId);
    return view(entity, role);
  }

  private OrganizationView view(OrganizationEntity e, String role) {
    return new OrganizationView(e.id, e.name, e.status, e.version, role);
  }
}
