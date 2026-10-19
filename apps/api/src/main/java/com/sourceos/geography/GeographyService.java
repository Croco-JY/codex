package com.sourceos.geography;
import jakarta.validation.constraints.*;
import java.util.*;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.simple.JdbcClient;
import com.sourceos.authorization.PlatformAuthorization;
import com.sourceos.audit.AuditRecorder;
import com.sourceos.shared.ValidationRules;
@Service
public class GeographyService {
 public enum RegionType {PROVINCE,PREFECTURE,METROPOLITAN,CITY,DISTRICT,OTHER}
 public record Country(UUID id,String alpha2,String alpha3,String nameEn,String nameNative,boolean active,long version){}
 public record CountryInput(@NotBlank @Size(max=160) String nameEn,@NotBlank @Size(max=160) String nameNative,boolean active,@Min(0) long version){}
 public record Region(UUID id,UUID countryId,UUID parentRegionId,String code,String nameEn,String nameNative,RegionType regionType,boolean active,long version){}
 public record RegionInput(@NotNull UUID countryId,UUID parentRegionId,@Size(max=80) String code,@NotBlank @Size(max=160) String nameEn,@Size(max=160) String nameNative,@NotNull RegionType regionType,boolean active,@Min(0) long version){}
 public record Cluster(UUID id,UUID countryId,UUID regionId,String slug,String nameEn,String nameNative,String description,boolean active,long version){}
 public record ClusterInput(@NotNull UUID countryId,UUID regionId,@NotBlank @Pattern(regexp="[a-z0-9][a-z0-9-]{0,99}") String slug,@NotBlank @Size(max=160) String nameEn,@Size(max=160) String nameNative,@Size(max=4000) String description,boolean active,@Min(0) long version){}
 private final JdbcClient jdbc;private final PlatformAuthorization auth;private final AuditRecorder audit;
 public GeographyService(JdbcClient jdbc,PlatformAuthorization auth,AuditRecorder audit){this.jdbc=jdbc;this.auth=auth;this.audit=audit;}
 public List<Country> countries(){return jdbc.sql("SELECT * FROM country ORDER BY alpha2 LIMIT 100").query((rs,n)->new Country(rs.getObject("id",UUID.class),rs.getString("alpha2"),rs.getString("alpha3"),rs.getString("name_en"),rs.getString("name_native"),rs.getBoolean("active"),rs.getLong("version"))).list();}
 public List<Region> regions(UUID country){return jdbc.sql("SELECT * FROM region WHERE (CAST(:country AS uuid) IS NULL OR country_id=:country) ORDER BY name_en,id LIMIT 100").param("country",country,java.sql.Types.OTHER).query((rs,n)->new Region(rs.getObject("id",UUID.class),rs.getObject("country_id",UUID.class),rs.getObject("parent_region_id",UUID.class),rs.getString("code"),rs.getString("name_en"),rs.getString("name_native"),RegionType.valueOf(rs.getString("region_type")),rs.getBoolean("active"),rs.getLong("version"))).list();}
 public List<Cluster> clusters(UUID country){return jdbc.sql("SELECT * FROM industrial_cluster WHERE (CAST(:country AS uuid) IS NULL OR country_id=:country) ORDER BY name_en,id LIMIT 100").param("country",country,java.sql.Types.OTHER).query((rs,n)->new Cluster(rs.getObject("id",UUID.class),rs.getObject("country_id",UUID.class),rs.getObject("region_id",UUID.class),rs.getString("slug"),rs.getString("name_en"),rs.getString("name_native"),rs.getString("description"),rs.getBoolean("active"),rs.getLong("version"))).list();}
 @Transactional public void country(UUID id,CountryInput v){auth.requireAdmin();int n=jdbc.sql("UPDATE country SET name_en=:name,name_native=:native,active=:active,version=version+1,updated_at=now() WHERE id=:id AND version=:version").param("id",id).param("version",v.version()).param("name",v.nameEn()).param("native",v.nameNative()).param("active",v.active()).update();if(n!=1)throw ValidationRules.conflict();audit.changed("country.updated","Country",id,null,Map.of("name",v.nameEn()));}
 @Transactional public UUID region(UUID id,RegionInput v){auth.requireAdmin();boolean create=id==null;UUID key=create?UUID.randomUUID():id;
  String sql=create?"INSERT INTO region(id,country_id,parent_region_id,code,name_en,name_native,region_type,active) VALUES(:id,:country,:parent,:code,:name,:native,:type,:active)":"UPDATE region SET country_id=:country,parent_region_id=:parent,code=:code,name_en=:name,name_native=:native,region_type=:type,active=:active,version=version+1,updated_at=now() WHERE id=:id AND version=:version";
  var q=jdbc.sql(sql).param("id",key).param("country",v.countryId()).param("parent",v.parentRegionId()).param("code",v.code()).param("name",v.nameEn()).param("native",v.nameNative()).param("type",v.regionType().name()).param("active",v.active());if(!create)q.param("version",v.version());if(q.update()!=1)throw ValidationRules.conflict();audit.changed(create?"region.created":"region.updated","Region",key,null,Map.of("name",v.nameEn()));return key;
 }
 @Transactional public UUID cluster(UUID id,ClusterInput v){auth.requireAdmin();boolean create=id==null;UUID key=create?UUID.randomUUID():id;
  String sql=create?"INSERT INTO industrial_cluster(id,country_id,region_id,slug,name_en,name_native,description,active) VALUES(:id,:country,:region,:slug,:name,:native,:description,:active)":"UPDATE industrial_cluster SET country_id=:country,region_id=:region,slug=:slug,name_en=:name,name_native=:native,description=:description,active=:active,version=version+1,updated_at=now() WHERE id=:id AND version=:version";
  var q=jdbc.sql(sql).param("id",key).param("country",v.countryId()).param("region",v.regionId()).param("slug",v.slug()).param("name",v.nameEn()).param("native",v.nameNative()).param("description",v.description()).param("active",v.active());if(!create)q.param("version",v.version());if(q.update()!=1)throw ValidationRules.conflict();audit.changed(create?"cluster.created":"cluster.updated","IndustrialCluster",key,null,Map.of("name",v.nameEn()));return key;
 }
}
