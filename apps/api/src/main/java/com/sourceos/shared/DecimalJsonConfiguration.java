package com.sourceos.shared;

import io.swagger.v3.oas.models.media.StringSchema;
import java.math.BigDecimal;
import org.springdoc.core.utils.SpringDocUtils;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.ValueSerializer;
import tools.jackson.databind.module.SimpleModule;

/** Exact decimals at the HTTP boundary; domain arithmetic and database JSON remain unchanged. */
@Configuration
class DecimalJsonConfiguration {
  static {
    SpringDocUtils.getConfig()
        .replaceWithSchema(BigDecimal.class, new StringSchema().format("decimal"));
  }

  @Bean
  JsonMapperBuilderCustomizer exactDecimalJson() {
    var module = new SimpleModule("source-os-exact-decimals");
    module.addSerializer(
        BigDecimal.class,
        new ValueSerializer<BigDecimal>() {
          @Override
          public void serialize(
              BigDecimal value, JsonGenerator generator, SerializationContext context) {
            generator.writeString(value.toPlainString());
          }
        });
    // Jackson's standard BigDecimal deserializer already accepts decimal strings exactly.
    return builder -> builder.addModule(module);
  }
}
