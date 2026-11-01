package com.sourceos.authorization;

import javax.sql.DataSource;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.*;

@Configuration(proxyBeanMethods = false)
class ReleaseTransactionConfiguration {
  @Bean
  static BeanPostProcessor releaseDataSourceGuard() {
    return new BeanPostProcessor() {
      @Override
      public Object postProcessAfterInitialization(Object bean, String name) {
        return bean instanceof DataSource ds && !(bean instanceof ReleaseDataSource)
            ? new ReleaseDataSource(ds)
            : bean;
      }
    };
  }
}
