/**
 * Shared auto-sync hook — load config, trigger on startup (delayed), and periodically.
 * Used by both desktop (Tauri) and mobile (Expo) apps.
 *
 * @param onSyncComplete Optional callback when a download sync completes (e.g., to reload the library)
 */
import { useEffect, useRef } from "react";
import { useSyncStore } from "../stores/sync-store";

function hasAutoSync(config: unknown): config is { autoSync: boolean; syncIntervalMins?: number } {
  return typeof config === "object" && config !== null && "autoSync" in config;
}

/** Errors that retrying cannot fix: wrong credentials. Everything else is retried. */
export function isAuthSyncError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /unauthori[sz]ed|\b401\b|\b403\b|forbidden|No credentials configured|Sync not configured/i.test(
    error,
  );
}

let lastTriggeredAt = 0;

/**
 * Reading positions must follow the user between devices even when periodic
 * auto-sync is switched off: coming back to the app and opening a book always pull.
 * (Wi-Fi-only and credentials checks inside syncNow still apply.)
 */
export function requestPositionSync(reason: string, minGapMs = 30_000): Promise<void> {
  return requestAutoSync(reason, minGapMs, { evenIfAutoSyncOff: true });
}

/**
 * Ask for a sync now (app came to the foreground, a book was closed, ...).
 * Respects the auto-sync setting, skips while a sync runs, and is rate-limited so
 * rapid app switching does not hammer the server.
 */
export async function requestAutoSync(
  reason: string,
  minGapMs = 60_000,
  options: { evenIfAutoSyncOff?: boolean } = {},
): Promise<void> {
  const state = useSyncStore.getState();
  if (!state.isConfigured) return;
  if (!options.evenIfAutoSyncOff && !(hasAutoSync(state.config) && state.config.autoSync)) return;
  if (state.status !== "idle" && state.status !== "error") return;
  if (isAuthSyncError(state.error)) return;
  const now = Date.now();
  if (now - lastTriggeredAt < minGapMs) return;
  lastTriggeredAt = now;
  console.log(`[AutoSync] Sync requested: ${reason}`);
  await state.syncNow();
}

function withJitter(baseMs: number, maxJitterMs: number): number {
  const jitter = Math.floor(Math.random() * maxJitterMs);
  return baseMs + jitter;
}

export function useAutoSync(onSyncComplete?: () => void) {
  const config = useSyncStore((s) => s.config);
  const isConfigured = useSyncStore((s) => s.isConfigured);
  const syncNow = useSyncStore((s) => s.syncNow);
  const loadConfig = useSyncStore((s) => s.loadConfig);
  const status = useSyncStore((s) => s.status);
  const lastResult = useSyncStore((s) => s.lastResult);
  const error = useSyncStore((s) => s.error);
  const statusRef = useRef(status);
  statusRef.current = status;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  lastErrorRef.current = error;

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Refresh library after a successful download sync
  useEffect(() => {
    if (
      lastResult?.success &&
      (lastResult.direction === "download" || lastResult.filesDownloaded > 0)
    ) {
      onSyncComplete?.();
    }
  }, [lastResult, onSyncComplete]);

  // Delayed startup sync + periodic sync
  useEffect(() => {
    const autoSyncEnabled = hasAutoSync(config) && config.autoSync;

    if (!isConfigured || !autoSyncEnabled) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Credentials errors need the user; anything else (network blip, server hiccup)
    // is retried below instead of silently disabling auto-sync for the session.
    if (isAuthSyncError(lastErrorRef.current)) {
      console.log("[AutoSync] Skipping auto-sync due to auth/config error");
      return;
    }

    const intervalMs = (hasAutoSync(config) ? config.syncIntervalMins || 30 : 30) * 60 * 1000;
    let cancelled = false;

    const scheduleNext = (delayMs: number) => {
      timerRef.current = setTimeout(async () => {
        if (cancelled) return;

        if (
          (statusRef.current === "idle" || statusRef.current === "error") &&
          !isAuthSyncError(lastErrorRef.current)
        ) {
          lastTriggeredAt = Date.now();
          await syncNow();
        }

        if (!cancelled) {
          // After a failure, retry sooner (2 min) rather than waiting a full interval.
          const failed = useSyncStore.getState().status === "error";
          const nextMs = failed ? Math.min(intervalMs, 2 * 60_000) : intervalMs;
          scheduleNext(withJitter(nextMs, Math.min(60_000, Math.floor(nextMs * 0.1))));
        }
      }, delayMs);
    };

    scheduleNext(withJitter(10_000, 10_000));

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isConfigured, config, syncNow]);
}
