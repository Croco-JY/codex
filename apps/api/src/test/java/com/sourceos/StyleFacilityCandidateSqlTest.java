package com.sourceos;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

class StyleFacilityCandidateSqlTest extends StyleFacilityCandidateSupport {
  @MockitoSpyBean JdbcClient observedJdbc;

  @Test
  void candidateWriteUsesNoSupplierOrCapabilityQueries() {
    clearInvocations(observedJdbc);
    var edge = add();
    candidates.remove(org, project.id(), style.id(), edge.id(), "unlink");
    var sql =
        mockingDetails(observedJdbc).getInvocations().stream()
            .filter(i -> i.getMethod().getName().equals("sql"))
            .map(i -> i.getArgument(0).toString().toLowerCase())
            .toList();
    assertThat(sql)
        .anyMatch(
            s ->
                s.contains("select id,supplier_id,status from facility")
                    && s.contains("for share"));
    assertThat(sql).noneMatch(s -> s.contains("supplier_profile") || s.contains("capability"));
  }
}
