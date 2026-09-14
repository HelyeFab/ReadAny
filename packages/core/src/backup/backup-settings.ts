/**
 * The settings a backup carries, and what to do about the secrets in them.
 *
 * A backup restores a library but not the machinery that reads it with you:
 * which AI endpoint, which model, and the key that talks to it. Those live in
 * `readany-store/settings.json` and the platform keystore, not in SQLite, so
 * the sync snapshot cannot reach them and a restored device comes up with the
 * whole library and no AI.
 *
 * API keys are the reason this needs a decision rather than a default. A
 * backup file is a thing you put somewhere — a share sheet, a cloud drive, a
 * chat to yourself — and a key inside it is a credential travelling in the
 * clear. So the key is stripped unless the person making the backup asks for
 * it, and the file says which of the two it is.
 */
import { countAiConfigSecrets, stripAiConfigSecrets } from "../ai/ai-config-secrets";
import type { AIConfig } from "../types/chat";

export { countAiConfigSecrets, stripAiConfigSecrets };

/** Settings keys a backup knows how to carry. */
export const BACKUP_SETTING_KEYS = ["aiConfig"] as const;
export type BackupSettingKey = (typeof BACKUP_SETTING_KEYS)[number];

export interface BackupSettings {
  /**
   * Whether the values carry live API keys. Recorded rather than inferred so a
   * file can be described honestly before it is opened or shared.
   */
  includesSecrets: boolean;
  /** Setting values by key. Unknown keys are preserved but not understood. */
  values: Partial<Record<BackupSettingKey, unknown>> & Record<string, unknown>;
}

/** How a backup's settings section reads to someone deciding whether to apply it. */
export interface BackupSettingsSummary {
  keys: string[];
  includesSecrets: boolean;
  /** Endpoints in the file, and how many of them arrived with a usable key. */
  endpointCount: number;
  endpointsWithKeys: number;
}

function isAiConfig(value: unknown): value is AIConfig {
  if (typeof value !== "object" || value === null) return false;
  return Array.isArray((value as { endpoints?: unknown }).endpoints);
}

/**
 * Build the settings section of a backup.
 *
 * `includeSecrets` is the caller's answer to an explicit question, never a
 * default: false blanks every key on the way out.
 */
export function createBackupSettings(
  aiConfig: AIConfig,
  options: { includeSecrets: boolean },
): BackupSettings {
  const config = options.includeSecrets ? aiConfig : stripAiConfigSecrets(aiConfig);

  return {
    includesSecrets: options.includeSecrets && countAiConfigSecrets(aiConfig) > 0,
    values: { aiConfig: config },
  };
}

/** Structural check for a settings section read back off disk. */
export function isBackupSettings(value: unknown): value is BackupSettings {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as Partial<BackupSettings>;
  if (typeof settings.includesSecrets !== "boolean") return false;
  return typeof settings.values === "object" && settings.values !== null;
}

/** The AI config a backup holds, or null if it has none this build can read. */
export function readBackupAiConfig(settings: BackupSettings | undefined): AIConfig | null {
  const value = settings?.values?.aiConfig;
  return isAiConfig(value) ? value : null;
}

/** Describe a settings section without applying it. */
export function describeBackupSettings(
  settings: BackupSettings | undefined,
): BackupSettingsSummary | null {
  if (!settings) return null;

  const aiConfig = readBackupAiConfig(settings);

  return {
    keys: Object.keys(settings.values),
    includesSecrets: settings.includesSecrets,
    endpointCount: aiConfig ? aiConfig.endpoints.length : 0,
    endpointsWithKeys: aiConfig ? countAiConfigSecrets(aiConfig) : 0,
  };
}

/**
 * The config to actually apply, given what the device already has.
 *
 * A keyless backup — the ordinary kind — would otherwise wipe working keys on
 * the device it is restored onto, replacing them with the blanks it carries.
 * Endpoints the device already knows keep their key; endpoints new to it
 * arrive keyless and need one entered.
 */
export function mergeRestoredAiConfig(restored: AIConfig, current: AIConfig): AIConfig {
  const currentKeyById = new Map(
    current.endpoints.filter((e) => e.apiKey).map((e) => [e.id, e.apiKey] as const),
  );

  return {
    ...restored,
    endpoints: restored.endpoints.map((endpoint) =>
      endpoint.apiKey ? endpoint : { ...endpoint, apiKey: currentKeyById.get(endpoint.id) ?? "" },
    ),
  };
}
