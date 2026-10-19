package com.sourceos;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.sql.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
@Testcontainers
class MigrationUpgradeTest {
 @Container static PostgreSQLContainer db=new PostgreSQLContainer("postgres:18.3");
 @Test void populatedPhaseZeroUpgradesWithoutChangingAuditOrGuards() throws Exception {
  Flyway.configure().dataSource(db.getJdbcUrl(),db.getUsername(),db.getPassword()).target("2").load().migrate();
  UUID org=UUID.randomUUID(),event=UUID.randomUUID();
  try(var c=DriverManager.getConnection(db.getJdbcUrl(),db.getUsername(),db.getPassword());var stmt=c.createStatement()){
   stmt.execute("INSERT INTO organization(id,name) VALUES('"+org+"','Legacy')");
   stmt.execute("INSERT INTO membership(id,organization_id,issuer,subject,role) VALUES(gen_random_uuid(),'"+org+"','legacy-issuer','legacy-user','ORG_OWNER')");
   stmt.execute("INSERT INTO audit_event(id,actor_issuer,actor_subject,organization_id,action,request_id) VALUES('"+event+"','legacy-issuer','legacy-user','"+org+"','legacy.created','legacy-request')");
  }
  var flyway=Flyway.configure().dataSource(db.getJdbcUrl(),db.getUsername(),db.getPassword()).load();flyway.migrate();flyway.validate();
  try(var c=DriverManager.getConnection(db.getJdbcUrl(),db.getUsername(),db.getPassword());var stmt=c.createStatement()){
   var rs=stmt.executeQuery("SELECT scope,organization_id,actor_subject,request_id,entity_id FROM audit_event WHERE id='"+event+"'");assertThat(rs.next()).isTrue();assertThat(rs.getString(1)).isEqualTo("ORGANIZATION");assertThat(rs.getObject(2)).isEqualTo(org);assertThat(rs.getString(3)).isEqualTo("legacy-user");assertThat(rs.getString(4)).isEqualTo("legacy-request");assertThat(rs.getObject(5)).isNull();
   for(String sql:List.of("UPDATE audit_event SET action='bad'","DELETE FROM audit_event","TRUNCATE audit_event"))assertThatThrownBy(()->stmt.execute(sql)).isInstanceOf(SQLException.class).hasMessageContaining("append-only");
  }
 }
}
