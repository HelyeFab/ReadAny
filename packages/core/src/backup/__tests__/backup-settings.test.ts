import { describe, expect, it } from "vitest";

import type { AIConfig, AIEndpoint } from "../../types/chat";
import {
  countAiConfigSecrets,
  createBackupSettings,
  describeBackupSettings,
  isBackupSettings,
  mergeRestoredAiConfig,
  readBackupAiConfig,
  stripAiConfigSecrets,
} from "../backup-settings";

function endpoint(overrides: Partial<AIEndpoint> = {}): AIEndpoint {
  return {
    id: overrides.id ?? "ep-1",
    name: overrides.name ?? "OpenAI",
    provider: overrides.provider ?? "openai",
    apiKey: overrides.apiKey ?? "sk-secret",
    baseUrl: overrides.baseUrl ?? "https://api.openai.com/v1",
    models: overrides.models ?? ["gpt-4o"],
    modelsFetched: overrides.modelsFetched ?? true,
  };
}

function aiConfig(overrides: Partial<AIConfig> = {}): AIConfig {
  return {
    endpoints: overrides.endpoints ?? [endpoint()],
    activeEndpointId: overrides.activeEndpointId ?? "ep-1",
    activeModel: overrides.activeModel ?? "gpt-4o",
    temperature: overrides.temperature ?? 0.7,
    maxTokens: overrides.maxTokens ?? 8192,
    slidingWindowSize: overrides.slidingWindowSize ?? 20,
  };
}

describe("stripAiConfigSecrets", () => {
  it("blanks every key and keeps everything else", () => {
    const config = aiConfig({
      endpoints: [endpoint({ id: "a", apiKey: "sk-a" }), endpoint({ id: "b", apiKey: "sk-b" })],
    });

    const stripped = stripAiConfigSecrets(config);

    expect(stripped.endpoints.map((e) => e.apiKey)).toEqual(["", ""]);
    expect(stripped.endpoints.map((e) => e.id)).toEqual(["a", "b"]);
    expect(stripped.activeModel).toBe("gpt-4o");
    expect(stripped.temperature).toBe(0.7);
  });

  it("does not mutate the config it was given", () => {
    const config = aiConfig();
    stripAiConfigSecrets(config);
    expect(config.endpoints[0].apiKey).toBe("sk-secret");
  });
});

describe("createBackupSettings", () => {
  it("strips keys unless asked for them", () => {
    const settings = createBackupSettings(aiConfig(), { includeSecrets: false });
    const restored = readBackupAiConfig(settings);

    expect(settings.includesSecrets).toBe(false);
    expect(restored?.endpoints[0].apiKey).toBe("");
  });

  it("carries keys when asked, and says so", () => {
    const settings = createBackupSettings(aiConfig(), { includeSecrets: true });

    expect(settings.includesSecrets).toBe(true);
    expect(readBackupAiConfig(settings)?.endpoints[0].apiKey).toBe("sk-secret");
  });

  it("does not claim to include secrets when there were none to include", () => {
    const keyless = aiConfig({ endpoints: [endpoint({ apiKey: "" })] });
    const settings = createBackupSettings(keyless, { includeSecrets: true });

    expect(settings.includesSecrets).toBe(false);
  });
});

describe("describeBackupSettings", () => {
  it("reports nothing for a backup with no settings section", () => {
    expect(describeBackupSettings(undefined)).toBeNull();
  });

  it("counts endpoints and the keys among them", () => {
    const config = aiConfig({
      endpoints: [
        endpoint({ id: "a", apiKey: "sk-a" }),
        endpoint({ id: "b", apiKey: "" }),
        endpoint({ id: "c", apiKey: "sk-c" }),
      ],
    });

    const summary = describeBackupSettings(createBackupSettings(config, { includeSecrets: true }));

    expect(summary).toEqual({
      keys: ["aiConfig"],
      includesSecrets: true,
      endpointCount: 3,
      endpointsWithKeys: 2,
    });
  });
});

describe("isBackupSettings", () => {
  it("accepts a real section", () => {
    expect(isBackupSettings(createBackupSettings(aiConfig(), { includeSecrets: false }))).toBe(
      true,
    );
  });

  it.each([null, undefined, 42, "aiConfig", {}, { values: {} }, { includesSecrets: true }])(
    "rejects %p",
    (value) => {
      expect(isBackupSettings(value)).toBe(false);
    },
  );
});

describe("readBackupAiConfig", () => {
  it("returns null when the section holds no AI config", () => {
    expect(readBackupAiConfig({ includesSecrets: false, values: {} })).toBeNull();
  });

  it("returns null for a value that is not shaped like one", () => {
    expect(
      readBackupAiConfig({ includesSecrets: false, values: { aiConfig: { nope: 1 } } }),
    ).toBeNull();
  });
});

describe("mergeRestoredAiConfig", () => {
  it("keeps the key this device already has when the backup carries none", () => {
    const restored = aiConfig({ endpoints: [endpoint({ id: "a", apiKey: "" })] });
    const current = aiConfig({ endpoints: [endpoint({ id: "a", apiKey: "sk-local" })] });

    expect(mergeRestoredAiConfig(restored, current).endpoints[0].apiKey).toBe("sk-local");
  });

  it("prefers the backup's key when it has one", () => {
    const restored = aiConfig({ endpoints: [endpoint({ id: "a", apiKey: "sk-backup" })] });
    const current = aiConfig({ endpoints: [endpoint({ id: "a", apiKey: "sk-local" })] });

    expect(mergeRestoredAiConfig(restored, current).endpoints[0].apiKey).toBe("sk-backup");
  });

  it("leaves an endpoint this device has never seen without a key", () => {
    const restored = aiConfig({ endpoints: [endpoint({ id: "new", apiKey: "" })] });
    const current = aiConfig({ endpoints: [endpoint({ id: "old", apiKey: "sk-old" })] });

    expect(mergeRestoredAiConfig(restored, current).endpoints[0].apiKey).toBe("");
  });

  it("takes the rest of the config from the backup", () => {
    const restored = aiConfig({ activeModel: "claude-opus-5", temperature: 0.2 });
    const current = aiConfig({ activeModel: "gpt-4o", temperature: 0.9 });
    const merged = mergeRestoredAiConfig(restored, current);

    expect(merged.activeModel).toBe("claude-opus-5");
    expect(merged.temperature).toBe(0.2);
  });
});

describe("countAiConfigSecrets", () => {
  it("counts only endpoints holding a key", () => {
    const config = aiConfig({
      endpoints: [endpoint({ id: "a", apiKey: "k" }), endpoint({ id: "b", apiKey: "" })],
    });
    expect(countAiConfigSecrets(config)).toBe(1);
  });
});
