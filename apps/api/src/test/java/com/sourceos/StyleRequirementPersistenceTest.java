package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class StyleRequirementPersistenceTest extends StyleRequirementSupport {
  @Test
  void productionConstraintsAndIdentityAndDestructionGuardsStayActive() throws Exception {
    create();
    try (var c = DriverManager.getConnection(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
        var q = c.createStatement()) {
      c.setAutoCommit(false);
      try {
        for (String sql :
            List.of(
                "UPDATE style_requirement SET style_id='"
                    + foreignStyle.id()
                    + "' WHERE style_id='"
                    + style.id()
                    + "'",
                "UPDATE style_requirement SET created_at=created_at+interval '1 second' WHERE"
                    + " style_id='"
                    + style.id()
                    + "'")) {
          var point = c.setSavepoint();
          assertThatThrownBy(() -> q.execute(sql))
              .isInstanceOf(SQLException.class)
              .hasMessageContaining("Requirement identity is immutable");
          c.rollback(point);
        }
        for (String sql :
            List.of(
                "DELETE FROM style_requirement WHERE style_id='" + style.id() + "'",
                "TRUNCATE style_requirement")) {
          var point = c.setSavepoint();
          assertThatThrownBy(() -> q.execute(sql))
              .isInstanceOf(SQLException.class)
              .hasMessageContaining("Workspace rows cannot be deleted or truncated");
          c.rollback(point);
        }
        for (String expression :
            List.of(
                "target_quantity=-1",
                "target_quantity='NaN',quantity_unit='PCS'",
                "target_cost='NaN',currency='USD',quantity_unit='PCS'",
                "target_cost=-1,currency='USD',quantity_unit='PCS'",
                "quantity_unit='KG'",
                "target_cost=1,quantity_unit='PCS'",
                "currency='USD'",
                "target_quantity=1",
                "target_cost=1,currency='USD'",
                "product_type=' '",
                "product_type=chr(9)",
                "notes=chr(10)",
                "notes=''",
                "version=-1",
                "target_cost=1,currency='usd',quantity_unit='PCS'")) {
          var point = c.setSavepoint();
          assertThatThrownBy(
                  () ->
                      q.execute(
                          "UPDATE style_requirement SET "
                              + expression
                              + " WHERE style_id='"
                              + style.id()
                              + "'"))
              .isInstanceOf(SQLException.class)
              .hasMessageContaining("check constraint");
          c.rollback(point);
        }
        var point = c.setSavepoint();
        assertThatThrownBy(
                () ->
                    q.execute(
                        "INSERT INTO style_requirement(style_id) VALUES('" + style.id() + "')"))
            .isInstanceOf(SQLException.class)
            .hasMessageContaining("duplicate key");
        c.rollback(point);
        assertThat(
                q.executeQuery(
                        "SELECT count(*) FROM style_requirement WHERE style_id='"
                            + style.id()
                            + "'")
                    .next())
            .isTrue();
      } finally {
        c.rollback();
      }
    }
    assertThat(requirements.read(org, project.id(), style.id()).version()).isZero();
  }
}
