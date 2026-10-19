package com.sourceos.dataingestion;
import java.util.*;import java.time.Instant;
import jakarta.validation.constraints.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.simple.JdbcClient;
import com.sourceos.authorization.PlatformAuthorization;
import com.sourceos.audit.AuditRecorder;
import com.sourceos.shared.ValidationRules;
@Service
public class SourceService {
 public enum SourceType {OFFICIAL_WEBSITE,PUBLIC_DIRECTORY,PARTNER_FEED,MANUAL_ENTRY,SUPPLIER_SUBMISSION,TRADE_SHOW,OTHER}
 public enum AccessMethod {MANUAL,API,FEED,PERMITTED_WEB,OTHER}
 public enum Normalization {PRESERVE,TRIM}
 public enum RecordKind {SUPPLIER,FACILITY,MATERIAL,MATERIAL_VARIANT}
 public enum ReviewStatus {ACCEPTED,REJECTED,NEEDS_REVIEW}
 public enum PermissionStatus {UNKNOWN,PERMITTED,RESTRICTED,PROHIBITED}
 public record SourceInput(@NotBlank @Pattern(regexp="[A-Za-z0-9][A-Za-z0-9._-]{0,99}") String sourceCode,@NotNull SourceType sourceType,@NotBlank @Size(max=160) String name,@Size(max=160) String namespace,@Size(max=2000) String baseUrl,@NotNull AccessMethod accessMethod,@NotNull Normalization normalizationPolicy,boolean active,@Min(0) long version){}
 public record RecordInput(@NotNull UUID dataSourceId,@NotNull RecordKind recordKind,@NotBlank @Size(max=500) String externalRecordKey){}
 public record RecordView(UUID id,UUID dataSourceId,RecordKind recordKind,String externalRecordKey,String normalizedExternalRecordKey,Instant firstSeenAt,Instant lastSeenAt){}
 public record ObservationInput(@NotNull UUID sourceRecordId,@NotBlank @Size(max=200) String observationKey,@NotNull Instant observedAt,Instant retrievedAt,@Pattern(regexp="[a-f0-9]{64}") String contentHash,@Pattern(regexp="SHA-256") String hashAlgorithm,UUID supersedesObservationId){ public ObservationInput { if(observedAt!=null)observedAt=observedAt.truncatedTo(java.time.temporal.ChronoUnit.MICROS); if(retrievedAt!=null)retrievedAt=retrievedAt.truncatedTo(java.time.temporal.ChronoUnit.MICROS); } }
 public record Observation(UUID id,UUID sourceRecordId,String observationKey,Instant observedAt,Instant recordedAt,Instant retrievedAt,String contentHash,String hashAlgorithm,UUID supersedesObservationId){}
 public record ReviewInput(@NotNull ReviewStatus reviewStatus,PermissionStatus licenseStatus,PermissionStatus termsStatus,@Size(max=1000) String notes){}
 public record Review(UUID id,UUID observationId,ReviewStatus reviewStatus,String licenseStatus,String termsStatus,String reviewedByIssuer,String reviewedBySubject,Instant reviewedAt,String notes){}
 private final com.sourceos.identity.IdentityService identities;private final JdbcClient jdbc;private final PlatformAuthorization auth;private final AuditRecorder audit;
 public SourceService(JdbcClient jdbc,PlatformAuthorization auth,AuditRecorder audit,com.sourceos.identity.IdentityService identities){this.identities=identities;this.jdbc=jdbc;this.auth=auth;this.audit=audit;}
 @Transactional public UUID source(UUID id,SourceInput v){auth.requireAdmin();ValidationRules.url(v.baseUrl());boolean create=id==null;UUID key=create?UUID.randomUUID():id;
  String sql=create?"INSERT INTO data_source(id,source_code,source_type,name,namespace,base_url,access_method,normalization_policy,active) VALUES(:id,:code,:type,:name,:namespace,:url,:access,:policy,:active)":"UPDATE data_source SET source_code=:code,source_type=:type,name=:name,namespace=:namespace,base_url=:url,access_method=:access,normalization_policy=:policy,active=:active,version=version+1,updated_at=now() WHERE id=:id AND version=:version";
  var q=jdbc.sql(sql).param("id",key).param("code",v.sourceCode()).param("type",v.sourceType().name()).param("name",v.name()).param("namespace",v.namespace()).param("url",v.baseUrl()).param("access",v.accessMethod().name()).param("policy",v.normalizationPolicy().name()).param("active",v.active());if(!create)q.param("version",v.version());if(q.update()!=1)throw ValidationRules.conflict();audit.changed(create?"source.created":"source.updated","DataSource",key,null,Map.of("sourceCode",v.sourceCode()));return key;
 }
 @Transactional public RecordView record(RecordInput v){auth.requireAdmin();String policy=jdbc.sql("SELECT normalization_policy FROM data_source WHERE id=:id AND active FOR SHARE").param("id",v.dataSourceId()).query(String.class).optional().orElseThrow(ValidationRules::missing);
  // Source-specific key contract; raw external ID is never changed or globally case-folded.
  String key=policy.equals("TRIM")?v.externalRecordKey().replaceAll("^ +| +$",""):v.externalRecordKey();
  jdbc.sql("INSERT INTO data_source_record(id,data_source_id,record_kind,external_record_key,normalized_external_record_key) VALUES(:id,:source,:kind,:raw,:key) ON CONFLICT(data_source_id,record_kind,normalized_external_record_key) DO NOTHING")
   .param("id",UUID.randomUUID()).param("source",v.dataSourceId()).param("kind",v.recordKind().name()).param("raw",v.externalRecordKey()).param("key",key).update();
  var result=jdbc.sql("SELECT * FROM data_source_record WHERE data_source_id=:source AND record_kind=:kind AND normalized_external_record_key=:key").param("source",v.dataSourceId()).param("kind",v.recordKind().name()).param("key",key).query((rs,n)->new RecordView(rs.getObject("id",UUID.class),rs.getObject("data_source_id",UUID.class),RecordKind.valueOf(rs.getString("record_kind")),rs.getString("external_record_key"),rs.getString("normalized_external_record_key"),rs.getObject("first_seen_at",java.time.OffsetDateTime.class)==null?null:rs.getObject("first_seen_at",java.time.OffsetDateTime.class).toInstant(),rs.getObject("last_seen_at",java.time.OffsetDateTime.class)==null?null:rs.getObject("last_seen_at",java.time.OffsetDateTime.class).toInstant())).single();
  audit.changed("source.identity.resolved","DataSourceRecord",result.id(),null,Map.of("recordKind",v.recordKind().name()));return result;
 }
 /** Identity Resolution callers lock this record before creating the canonical entity and binding. */
 public void lockRecord(UUID id,RecordKind kind){if(jdbc.sql("SELECT id FROM data_source_record WHERE id=:id AND record_kind=:kind FOR UPDATE").param("id",id).param("kind",kind.name()).query(UUID.class).optional().isEmpty())throw ValidationRules.bad("External record kind does not match");}
 public void requireObservation(UUID id){if(!jdbc.sql("SELECT EXISTS(SELECT 1 FROM data_source_observation WHERE id=:id)").param("id",id).query(Boolean.class).single())throw ValidationRules.missing();}
 private Observation map(java.sql.ResultSet rs) throws java.sql.SQLException{return new Observation(rs.getObject("id",UUID.class),rs.getObject("source_record_id",UUID.class),rs.getString("observation_key"),rs.getObject("observed_at",java.time.OffsetDateTime.class).toInstant(),rs.getObject("recorded_at",java.time.OffsetDateTime.class).toInstant(),rs.getObject("retrieved_at",java.time.OffsetDateTime.class)==null?null:rs.getObject("retrieved_at",java.time.OffsetDateTime.class).toInstant(),rs.getString("content_hash"),rs.getString("hash_algorithm"),rs.getObject("supersedes_observation_id",UUID.class));}
 @Transactional public Observation observe(ObservationInput v){auth.requireAdmin();if((v.contentHash()==null)!=(v.hashAlgorithm()==null))throw ValidationRules.bad("Hash and algorithm must be supplied together");
  if(jdbc.sql("SELECT id FROM data_source_record WHERE id=:id FOR UPDATE").param("id",v.sourceRecordId()).query(UUID.class).optional().isEmpty())throw ValidationRules.missing();
  var prior=jdbc.sql("SELECT * FROM data_source_observation WHERE source_record_id=:record AND observation_key=:key").param("record",v.sourceRecordId()).param("key",v.observationKey()).query((rs,n)->map(rs)).optional();
  if(prior.isPresent()){var p=prior.get();if(!p.observedAt().equals(v.observedAt())||!Objects.equals(p.retrievedAt(),v.retrievedAt())||!Objects.equals(p.contentHash(),v.contentHash())||!Objects.equals(p.hashAlgorithm(),v.hashAlgorithm())||!Objects.equals(p.supersedesObservationId(),v.supersedesObservationId()))throw ValidationRules.conflict();return p;}
  UUID id=UUID.randomUUID();jdbc.sql("INSERT INTO data_source_observation(id,source_record_id,observation_key,observed_at,retrieved_at,content_hash,hash_algorithm,supersedes_observation_id) VALUES(:id,:record,:key,:observed,:retrieved,:hash,:algorithm,:supersedes)").param("id",id).param("record",v.sourceRecordId()).param("key",v.observationKey()).param("observed",java.time.OffsetDateTime.ofInstant(v.observedAt(),java.time.ZoneOffset.UTC)).param("retrieved",v.retrievedAt()==null?null:java.time.OffsetDateTime.ofInstant(v.retrievedAt(),java.time.ZoneOffset.UTC)).param("hash",v.contentHash()).param("algorithm",v.hashAlgorithm()).param("supersedes",v.supersedesObservationId()).update();
  jdbc.sql("UPDATE data_source_record SET first_seen_at=LEAST(first_seen_at,:at),last_seen_at=GREATEST(last_seen_at,:at) WHERE id=:id").param("at",java.time.OffsetDateTime.ofInstant(v.observedAt(),java.time.ZoneOffset.UTC)).param("id",v.sourceRecordId()).update();
  audit.changed("source.observed","DataSourceObservation",id,null,Map.of("observationId",id));return jdbc.sql("SELECT * FROM data_source_observation WHERE id=:id").param("id",id).query((rs,n)->map(rs)).single();
 }
 @Transactional public UUID review(UUID observation,ReviewInput v){auth.requireAdmin();ValidationRules.notes(v.notes());UUID id=UUID.randomUUID();
  // Reviewer comes from the security context, never a request-body identity.
  var actor=currentActor();jdbc.sql("INSERT INTO data_source_observation_review(id,observation_id,review_status,license_status,terms_status,reviewed_by_issuer,reviewed_by_subject,notes) VALUES(:id,:observation,:status,:license,:terms,:issuer,:subject,:notes)").param("id",id).param("observation",observation).param("status",v.reviewStatus().name()).param("license",v.licenseStatus()==null?null:v.licenseStatus().name()).param("terms",v.termsStatus()==null?null:v.termsStatus().name()).param("issuer",actor.issuer()).param("subject",actor.subject()).param("notes",v.notes()).update();
  audit.changed("source.reviewed","ObservationReview",id,null,Map.of("reviewStatus",v.reviewStatus().name()));return id;
 }
 private com.sourceos.identity.Actor currentActor(){return identities.current();}
 public List<Review> reviews(UUID observation){auth.requireAdmin();return jdbc.sql("SELECT * FROM data_source_observation_review WHERE observation_id=:id ORDER BY reviewed_at DESC,created_at DESC,id DESC LIMIT 100").param("id",observation).query((rs,n)->new Review(rs.getObject("id",UUID.class),rs.getObject("observation_id",UUID.class),ReviewStatus.valueOf(rs.getString("review_status")),rs.getString("license_status"),rs.getString("terms_status"),rs.getString("reviewed_by_issuer"),rs.getString("reviewed_by_subject"),rs.getObject("reviewed_at",java.time.OffsetDateTime.class).toInstant(),rs.getString("notes"))).list();}
 public List<Observation> observations(UUID record){auth.requireAdmin();return jdbc.sql("SELECT * FROM data_source_observation WHERE source_record_id=:id ORDER BY observed_at DESC,id DESC LIMIT 100").param("id",record).query((rs,n)->map(rs)).list();}
 public List<java.util.Map<String,Object>> sources(){auth.requireAdmin();return jdbc.sql("SELECT id,source_code,source_type,name,namespace,base_url,access_method,normalization_policy,active,version FROM data_source ORDER BY source_code LIMIT 100").query().listOfRows();}
}
