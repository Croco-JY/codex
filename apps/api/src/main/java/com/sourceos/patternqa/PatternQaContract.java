package com.sourceos.patternqa;

import io.swagger.v3.oas.models.media.ComposedSchema;
import io.swagger.v3.oas.models.media.Schema;
import java.util.List;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Explicit JSON Schema union: a referenced object schema alone cannot accept null. */
@Configuration(proxyBeanMethods = false)
class PatternQaContract {
  @Bean
  OpenApiCustomizer patternQaNullableLatestAssessment() {
    return api -> {
      var view = api.getComponents().getSchemas().get("PatternQaView");
      if (view != null)
        view.addProperty(
            "latestAssessment",
            new ComposedSchema()
                .oneOf(
                    List.of(
                        new Schema<>().$ref("#/components/schemas/PatternQaAssessmentView"),
                        new Schema<>().types(java.util.Set.of("null")))));
    };
  }
}
