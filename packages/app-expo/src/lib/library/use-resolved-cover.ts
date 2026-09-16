/**
 * Turn a book's stored cover path into something <Image> will accept.
 *
 * Covers are written relative to the app data directory, which moves between
 * installs, so the absolute path has to be rebuilt at render time. Remote and
 * already-absolute URLs are passed straight through. Every card on the shelf
 * needs this, and they must all agree — a cover that resolves on one card and
 * falls back to the drawing on another looks like missing art, not like two
 * code paths.
 */
import { getPlatformService } from "@readany/core/services";
import { useEffect, useState } from "react";

export function useResolvedCoverUrl(rawCoverUrl: string | undefined): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!rawCoverUrl) {
      setResolved(undefined);
      return;
    }
    if (
      rawCoverUrl.startsWith("http") ||
      rawCoverUrl.startsWith("blob") ||
      rawCoverUrl.startsWith("file")
    ) {
      setResolved(rawCoverUrl);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, rawCoverUrl);
        if (!cancelled) setResolved(absPath);
      } catch (err) {
        console.warn("[Library] Failed to resolve cover URL:", err);
        if (!cancelled) setResolved(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawCoverUrl]);

  return resolved;
}
