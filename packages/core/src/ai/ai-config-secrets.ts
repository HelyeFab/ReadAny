/**
 * Separating an AI config from the keys inside it.
 *
 * Two unrelated features need exactly this and must agree on it: a backup that
 * may not carry secrets into a shareable file, and the settings store, which
 * must not write a second plaintext copy of a key whose home is the platform
 * keystore. One definition, so the rule cannot drift apart between them.
 *
 * Deliberately a leaf: types only, no imports that pull in the database, the
 * sync engine or a model provider. The settings store reaches for it on every
 * save, and it should not drag a module graph along behind it.
 */
import type { AIConfig } from "../types/chat";

/** A copy of the config with every API key blanked. */
export function stripAiConfigSecrets(config: AIConfig): AIConfig {
  return {
    ...config,
    endpoints: config.endpoints.map((endpoint) => ({ ...endpoint, apiKey: "" })),
  };
}

/** How many endpoints hold a key — what "including secrets" would actually expose. */
export function countAiConfigSecrets(config: AIConfig): number {
  return config.endpoints.filter((endpoint) => Boolean(endpoint.apiKey)).length;
}
