package com.sourceos;
import com.sourceos.identity.Actor;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.util.*;
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("local")
abstract class SupplyIntegrationSupport {
 static final PostgreSQLContainer DB=new PostgreSQLContainer("postgres:18.3");
 static {DB.start();}
 @DynamicPropertySource static void properties(DynamicPropertyRegistry r){r.add("spring.datasource.url",DB::getJdbcUrl);r.add("spring.datasource.username",DB::getUsername);r.add("spring.datasource.password",DB::getPassword);r.add("source.storage-root",()->"/tmp/source-supply-test-storage");}
 @Autowired protected JdbcClient jdbc; @Autowired protected MockMvc mvc;
 protected String admin(){String sub="admin-"+UUID.randomUUID();jdbc.sql("INSERT INTO platform_role_assignment(id,issuer,subject,role,status,granted_by_issuer,granted_by_subject) VALUES(:id,'urn:source-os:local',:subject,'PLATFORM_ADMIN','ACTIVE','urn:source-os:local','fixture-operator')").param("id",UUID.randomUUID()).param("subject",sub).update();return sub;}
 protected void actor(String subject){SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(new Actor("urn:source-os:local",subject),null,List.of()));}
 protected UUID id(){return UUID.randomUUID();}
}
