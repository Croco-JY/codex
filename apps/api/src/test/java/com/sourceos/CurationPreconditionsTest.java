package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sourceos.material.MaterialService;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class CurationPreconditionsTest extends CatalogIntegrationSupport {
  @Autowired JsonMapper json;

  enum Resource {
    CAPABILITY,
    FABRIC,
    LEATHER
  }

  record Target(Resource resource, UUID parent, UUID capability) {
    String path() {
      return resource == Resource.CAPABILITY
          ? "/api/v1/admin/facilities/" + parent + "/capabilities/" + capability
          : "/api/v1/admin/materials/" + parent + "/" + suffix();
    }

    String suffix() {
      return resource == Resource.FABRIC ? "fabric-spec" : "leather-spec";
    }

    String readPath() {
      return resource == Resource.CAPABILITY
          ? path()
          : "/api/v1/materials/" + parent + "/" + suffix();
    }

    String valueField() {
      return switch (resource) {
        case CAPABILITY -> "minimumOrderQuantity";
        case FABRIC -> "gsm";
        case LEATHER -> "thicknessMinMm";
      };
    }
  }

  Target target(Resource resource) {
    actor(principal);
    return resource == Resource.CAPABILITY
        ? new Target(resource, facility(catalogSupplier, JP, null, null).id(), capability(null))
        : new Target(
            resource,
            material(
                    resource == Resource.FABRIC
                        ? MaterialService.Type.FABRIC
                        : MaterialService.Type.LEATHER)
                .id(),
            null);
  }

  Map<String, Object> body(Target target, UUID observationId, String value, long version) {
    var body = new LinkedHashMap<String, Object>();
    body.put("observationId", observationId);
    body.put("version", version);
    body.put(target.valueField(), value);
    if (target.resource() == Resource.CAPABILITY) {
      body.put("maximumOrderQuantity", "999999999999999.9999");
      body.put("quantityUnit", "METER");
      body.put("proficiencyLevel", "SPECIALIST");
      body.put("verificationStatus", "DOCUMENTED");
      body.put("notes", "Synthetic internal assignment notes " + value);
    }
    return body;
  }

  ResultActions write(Target target, Map<String, Object> body, String... preconditions)
      throws Exception {
    return writeAs(target, body, principal, preconditions);
  }

  ResultActions writeAs(
      Target target, Map<String, Object> body, String subject, String... preconditions)
      throws Exception {
    MockHttpServletRequestBuilder request =
        put(target.path())
            .header("X-Request-ID", "curation-reference")
            .contentType("application/json")
            .content(json.writeValueAsString(body));
    if (subject != null) request.header("X-Dev-Subject", subject);
    if (preconditions.length != 0) request.header("If-None-Match", (Object[]) preconditions);
    return mvc.perform(request);
  }

  void problem(ResultActions result, int status) throws Exception {
    result
        .andExpect(status().is(status))
        .andExpect(jsonPath("$.status").value(status))
        .andExpect(jsonPath("$.type").value("urn:source-os:problem:" + status))
        .andExpect(jsonPath("$.requestId").value("curation-reference"))
        .andExpect(header().string("X-Request-ID", "curation-reference"));
  }

  JsonNode read(Target target) throws Exception {
    return json.readTree(
        mvc.perform(get(target.readPath()).header("X-Dev-Subject", principal))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString());
  }

  long audits(Target target) {
    return jdbc.sql("SELECT count(*) FROM audit_event WHERE entity_id=:id")
        .param("id", target.parent())
        .query(Long.class)
        .single();
  }

  List<UUID> evidence(Target target) {
    var query =
        target.resource() == Resource.CAPABILITY
            ? jdbc.sql(
                    "SELECT source_observation_id FROM facility_capability_source"
                        + " WHERE facility_id=:id AND capability_id=:capability")
                .param("capability", target.capability())
            : jdbc.sql(
                    "SELECT source_observation_id FROM material_source"
                        + " WHERE material_id=:id AND field_name=:field")
                .param(
                    "field", target.resource() == Resource.FABRIC ? "FABRIC_SPEC" : "LEATHER_SPEC");
    return query.param("id", target.parent()).query(UUID.class).list();
  }

  @ParameterizedTest
  @EnumSource(Resource.class)
  void createAndUpdateIntentAreDistinctWith400404409And412(Resource resource) throws Exception {
    var target = target(resource);
    UUID otherObservation = observation(record);
    long before = audits(target);
    problem(write(target, body(target, observation, "1.1111", 0)), 404);
    problem(write(target, body(target, observation, "1.1111", 7)), 404);
    problem(write(target, body(target, observation, "1.1111", 7), "*"), 400);
    assertThat(audits(target)).isEqualTo(before);
    assertThat(evidence(target)).isEmpty();

    write(target, body(target, observation, "1.1111", 0), " \t* \t").andExpect(status().isOk());
    var first = read(target);
    assertThat(first.path("version").asLong()).isZero();
    assertThat(first.path(target.valueField()).asText()).isEqualTo("1.1111");
    long created = audits(target);

    problem(write(target, body(target, otherObservation, "2.2222", 0), "*"), 412);
    assertThat(read(target)).isEqualTo(first);
    assertThat(audits(target)).isEqualTo(created);
    assertThat(evidence(target)).containsExactly(observation);

    write(target, body(target, otherObservation, "2.2222", 0)).andExpect(status().isOk());
    var updated = read(target);
    assertThat(updated.path("version").asLong()).isEqualTo(1);
    assertThat(updated.path(target.valueField()).asText()).isEqualTo("2.2222");
    long updatedAudits = audits(target);

    problem(write(target, body(target, observation, "3.3333", 0), "*"), 412);
    problem(write(target, body(target, observation, "3.3333", 0)), 409);
    assertThat(read(target)).isEqualTo(updated);
    assertThat(audits(target)).isEqualTo(updatedAudits);
    assertThat(evidence(target)).containsExactlyInAnyOrder(observation, otherObservation);

    write(target, body(target, observation, "3.3333", 1)).andExpect(status().isOk());
    assertThat(read(target).path("version").asLong()).isEqualTo(2);
  }

  @ParameterizedTest
  @EnumSource(Resource.class)
  void invalidHeadersNeverBecomeOmittedOrCreate(Resource resource) throws Exception {
    var target = target(resource);
    long before = audits(target);
    var body = body(target, observation, "1.1111", 0);
    for (String value :
        List.of("", " \t", "\"0\"", "W/\"*\"", "*,*", "\"*\"", "0", "\u2003*\u2003"))
      problem(write(target, body, value), 400);
    problem(write(target, body, "*", "*"), 400);
    problem(write(target, body, "*", "\"0\""), 400);
    problem(write(target, body, "", "*"), 400);
    assertThat(audits(target)).isEqualTo(before);
    assertThat(evidence(target)).isEmpty();
    // None of the malformed requests inserted a row or consumed create intent.
    write(target, body, "*").andExpect(status().isOk());
    assertThat(read(target).path("version").asLong()).isZero();
  }

  record Attempt(int backendPid, Map<String, Object> body, MvcResult result) {}

  @ParameterizedTest
  @EnumSource(Resource.class)
  void concurrentFirstWritersHaveOneVersionZeroWinnerAndNoLosingEvidence(Resource resource)
      throws Exception {
    var target = target(resource);
    UUID otherObservation = observation(record);
    var bodies =
        List.of(
            body(target, observation, "1.1111", 0), body(target, otherObservation, "2.2222", 0));
    long before = audits(target);
    var ready = new CountDownLatch(2);
    var start = new CountDownLatch(1);
    List<Attempt> attempts = new ArrayList<>();
    try (var pool = Executors.newFixedThreadPool(2)) {
      List<Future<Attempt>> futures = new ArrayList<>();
      for (var body : bodies)
        futures.add(
            pool.submit(
                () ->
                    tx().execute(
                            transaction -> {
                              // Hold two independent, overlapping real PostgreSQL transactions.
                              int pid =
                                  jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single();
                              ready.countDown();
                              try {
                                if (!start.await(15, TimeUnit.SECONDS))
                                  throw new AssertionError("Concurrent writers did not start");
                                var response = write(target, body, "*").andReturn();
                                if (response.getResponse().getStatus() >= 400)
                                  transaction.setRollbackOnly();
                                return new Attempt(pid, body, response);
                              } catch (Exception e) {
                                throw new RuntimeException(e);
                              }
                            })));
      try {
        assertThat(ready.await(15, TimeUnit.SECONDS)).isTrue();
      } finally {
        start.countDown();
      }
      for (var future : futures) attempts.add(future.get(30, TimeUnit.SECONDS));
    }
    assertThat(attempts).extracting(Attempt::backendPid).doesNotHaveDuplicates();
    assertThat(attempts)
        .extracting(a -> a.result().getResponse().getStatus())
        .containsExactlyInAnyOrder(200, 412);
    var winner =
        attempts.stream()
            .filter(a -> a.result().getResponse().getStatus() == 200)
            .findFirst()
            .orElseThrow();
    var loser =
        attempts.stream()
            .filter(a -> a.result().getResponse().getStatus() == 412)
            .findFirst()
            .orElseThrow();
    var problem = json.readTree(loser.result().getResponse().getContentAsString());
    assertThat(problem.path("status").asInt()).isEqualTo(412);
    assertThat(problem.path("requestId").asText()).isEqualTo("curation-reference");
    var stored = read(target);
    assertThat(stored.path("version").asLong()).isZero();
    assertThat(stored.path(target.valueField()).asText())
        .isEqualTo(winner.body().get(target.valueField()));
    if (resource == Resource.CAPABILITY)
      assertThat(stored.path("notes").asText()).isEqualTo(winner.body().get("notes"));
    assertThat(evidence(target)).containsExactly((UUID) winner.body().get("observationId"));
    assertThat(evidence(target)).doesNotContain((UUID) loser.body().get("observationId"));
    assertThat(audits(target) - before).isEqualTo(resource == Resource.CAPABILITY ? 1 : 2);
  }

  @Test
  void adminReadContainsEditableStateAndBuyerProjectionStillExcludesNotes() throws Exception {
    var target = target(Resource.CAPABILITY);
    var input = body(target, observation, "0.0001", 0);
    write(target, input, "*").andExpect(status().isOk());
    var loaded = read(target);
    assertThat(loaded.path("facilityId").asText()).isEqualTo(target.parent().toString());
    assertThat(loaded.path("capabilityId").asText()).isEqualTo(target.capability().toString());
    assertThat(loaded.path("notes").asText()).isEqualTo(input.get("notes"));
    assertThat(loaded.path("proficiencyLevel").asText()).isEqualTo("SPECIALIST");
    assertThat(loaded.path("verificationStatus").asText()).isEqualTo("DOCUMENTED");
    assertThat(loaded.path("quantityUnit").asText()).isEqualTo("METER");
    assertThat(loaded.path("minimumOrderQuantity").isString()).isTrue();
    assertThat(loaded.path("minimumOrderQuantity").asText()).isEqualTo("0.0001");
    assertThat(loaded.path("maximumOrderQuantity").isString()).isTrue();
    assertThat(loaded.path("maximumOrderQuantity").asText()).isEqualTo("999999999999999.9999");
    assertThat(loaded.path("version").asLong()).isZero();
    // Hydrate from the protected read, preserve notes, then refetch the current version.
    input.put("notes", loaded.path("notes").asText());
    input.put("version", loaded.path("version").asLong());
    input.put("proficiencyLevel", "EXPERIENCED");
    write(target, input).andExpect(status().isOk());
    assertThat(read(target).path("version").asLong()).isEqualTo(1);
    assertThat(read(target).path("notes").asText()).isEqualTo(input.get("notes"));
    var publicRows =
        json.readTree(
            mvc.perform(
                    get("/api/v1/facilities/" + target.parent() + "/capabilities")
                        .header("X-Dev-Subject", "synthetic-buyer"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    assertThat(publicRows.size()).isEqualTo(1);
    assertThat(publicRows.get(0).has("notes")).isFalse();
  }

  @Test
  void adminReadRequiresPlatformAuthorityAndReturns404ForMissingTargets() throws Exception {
    var target = target(Resource.CAPABILITY);
    for (String path :
        List.of(target.path(), new Target(Resource.CAPABILITY, id(), target.capability()).path()))
      mvc.perform(get(path).header("X-Dev-Subject", principal)).andExpect(status().isNotFound());
    mvc.perform(get(target.path()).header("X-Dev-Subject", "synthetic-buyer"))
        .andExpect(status().isForbidden());
    mvc.perform(get(target.path())).andExpect(status().isUnauthorized());
    String owner = "curation-owner-" + id();
    UUID organization = id();
    jdbc.sql("INSERT INTO organization(id,name) VALUES(:id,'Synthetic curation owner')")
        .param("id", organization)
        .update();
    jdbc.sql(
            "INSERT INTO membership(id,organization_id,issuer,subject,role)"
                + " VALUES(:id,:org,'urn:source-os:local',:subject,'ORG_OWNER')")
        .param("id", id())
        .param("org", organization)
        .param("subject", owner)
        .update();
    mvc.perform(get(target.path()).header("X-Dev-Subject", owner))
        .andExpect(status().isForbidden());
  }

  @ParameterizedTest
  @EnumSource(Resource.class)
  void writesRetainAuthorityParentAndObservationValidation(Resource resource) throws Exception {
    var target = target(resource);
    var body = body(target, observation, "1.1111", 0);
    writeAs(target, body, null, "*").andExpect(status().isUnauthorized());
    problem(writeAs(target, body, "synthetic-buyer", "*"), 403);
    problem(write(new Target(resource, id(), target.capability()), body, "*"), 404);
    body.put("observationId", id());
    problem(write(target, body, "*"), 404);
    assertThat(evidence(target)).isEmpty();
  }

  @Test
  void capabilityValidationStillRejectsMissingUnitRangeAndSensitiveNotes() throws Exception {
    var target = target(Resource.CAPABILITY);
    var body = body(target, observation, "1.1111", 0);
    body.remove("quantityUnit");
    problem(write(target, body, "*"), 400);
    body.put("quantityUnit", "METER");
    body.put("maximumOrderQuantity", "0");
    problem(write(target, body, "*"), 400);
    body.put("minimumOrderQuantity", "-1");
    problem(write(target, body, "*"), 400);
    body.put("minimumOrderQuantity", "0");
    body.put("notes", "Authorization: synthetic sensitive note");
    problem(write(target, body, "*"), 400);
    assertThat(evidence(target)).isEmpty();
  }

  @Test
  void materialSubtypeConstraintsStillRejectCrossTypeCreates() throws Exception {
    for (var resource : List.of(Resource.FABRIC, Resource.LEATHER)) {
      var parent = target(resource == Resource.FABRIC ? Resource.LEATHER : Resource.FABRIC);
      var wrong = new Target(resource, parent.parent(), null);
      long before = audits(wrong);
      problem(write(wrong, body(wrong, observation, "1.1111", 0), "*"), 409);
      assertThat(audits(wrong)).isEqualTo(before);
      assertThat(evidence(wrong)).isEmpty();
    }
  }

  @Test
  void targetedAdminReadCanResolveKnownCapabilityBeyondBuyerHundredItemProjection()
      throws Exception {
    var target = target(Resource.CAPABILITY);
    String prefix = "CAP_" + id().toString().replace("-", "").toUpperCase(Locale.ROOT) + "_";
    jdbc.sql(
            "INSERT INTO capability(id,code,category,name_en) SELECT"
                + " gen_random_uuid(),:prefix||n,'PROCESS','Synthetic bounded capability' FROM"
                + " generate_series(1,101) n")
        .param("prefix", prefix)
        .update();
    jdbc.sql(
            "INSERT INTO facility_capability(facility_id,capability_id,notes,verification_status)"
                + " SELECT :facility,id,'Synthetic internal bounded note','UNVERIFIED' FROM"
                + " capability WHERE code LIKE :prefix")
        .param("facility", target.parent())
        .param("prefix", prefix + "%")
        .update();
    UUID beyond =
        jdbc.sql(
                "SELECT capability_id FROM facility_capability WHERE facility_id=:id ORDER BY"
                    + " capability_id OFFSET 100 LIMIT 1")
            .param("id", target.parent())
            .query(UUID.class)
            .single();
    var known = new Target(Resource.CAPABILITY, target.parent(), beyond);
    assertThat(read(known).path("notes").asText()).isEqualTo("Synthetic internal bounded note");
    var publicRows =
        json.readTree(
            mvc.perform(
                    get("/api/v1/facilities/" + target.parent() + "/capabilities")
                        .header("X-Dev-Subject", "synthetic-buyer"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    assertThat(publicRows.size()).isEqualTo(100);
    for (var row : publicRows) {
      assertThat(row.has("notes")).isFalse();
      assertThat(row.path("capabilityId").asText()).isNotEqualTo(beyond.toString());
    }
  }
}
