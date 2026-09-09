import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';

export interface ServiceResourceConfig {
  serviceName: string;
  serviceNamespace?: string;
  serviceVersion?: string;
  environment?: string;
}

/**
 * Creates an OpenTelemetry Resource with standardized service and deployment attributes.
 *
 * Values come from explicit config (preferred) or the standard OTEL_* env vars
 * (root .env). There are no hardcoded defaults — a missing service identity is
 * a fail-fast error, never a silent "unknown-service".
 */
export function createServiceResource(
  config?: Partial<ServiceResourceConfig>,
): Resource {
  const serviceName =
    config?.serviceName?.trim() || readEnv('OTEL_SERVICE_NAME');
  const serviceNamespace =
    config?.serviceNamespace?.trim() || readEnv('OTEL_SERVICE_NAMESPACE');
  const serviceVersion =
    config?.serviceVersion?.trim() || readEnv('OTEL_SERVICE_VERSION');
  const environment =
    config?.environment?.trim() || readEnv('OTEL_ENVIRONMENT');

  return new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_NAMESPACE]: serviceNamespace,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: environment,
  });
}

function readEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name} ` +
        `(pass explicit ServiceResourceConfig or set it in the root .env)`,
    );
  }
  return value;
}
