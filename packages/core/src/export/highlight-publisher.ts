/**
 * Highlight publisher — send an export to the WebDAV server the app is
 * already signed in to (a Nextcloud, a Synology, anything that speaks DAV).
 *
 * Highlights are the part of reading worth keeping, and a share sheet keeps
 * them only as well as whatever app catches the file. Writing them to the
 * same server the library already syncs with means they land somewhere that
 * is backed up, reachable from every device, and organised by the filing
 * rules rather than by whatever the share target felt like doing.
 *
 * The credentials are not asked for again: sync already stores a URL, a
 * username and a password, and this borrows them.
 */
import { getPlatformService } from "../services/platform";
import { SYNC_BACKEND_CONFIG_KEYS, SYNC_SECRET_KEYS } from "../sync/sync-backend";
import { WebDavClient } from "../sync/webdav-client";
import type { ExportFormat } from "./annotation-exporter";
import {
  type FiledPath,
  type FilingContext,
  type FilingOptions,
  buildFiledPath,
  mimeTypeFor,
  resolveCollision,
} from "./highlight-filing";

export interface WebDavCredentials {
  url: string;
  username: string;
  password: string;
  allowInsecure?: boolean;
}

export type PublishConflict = "keepBoth" | "overwrite";

export interface PublishRequest {
  content: string;
  format: ExportFormat;
  filing: FilingOptions;
  context: FilingContext;
  conflict?: PublishConflict;
}

export interface PublishResult {
  path: string;
  /** True when a name collision pushed the file to "… (2)". */
  renamed: boolean;
}

/**
 * The WebDAV account sync is configured with, or null when the user has not
 * set one up. Read straight from storage rather than the sync store so this
 * works the same on desktop and mobile, and outside React.
 */
export async function loadSyncWebDavCredentials(): Promise<WebDavCredentials | null> {
  const platform = getPlatformService();
  const [rawConfig, password] = await Promise.all([
    platform.kvGetItem(SYNC_BACKEND_CONFIG_KEYS.webdav),
    platform.kvGetItem(SYNC_SECRET_KEYS.webdav),
  ]);
  if (!rawConfig || !password) return null;
  try {
    const config = JSON.parse(rawConfig) as {
      url?: string;
      username?: string;
      allowInsecure?: boolean;
    };
    if (!config.url || !config.username) return null;
    return {
      url: config.url,
      username: config.username,
      password,
      allowInsecure: config.allowInsecure,
    };
  } catch {
    return null;
  }
}

/** Write one export to the server, creating the folders it needs. */
export async function publishHighlightsToWebDav(
  credentials: WebDavCredentials,
  request: PublishRequest,
): Promise<PublishResult> {
  const client = new WebDavClient(
    credentials.url,
    credentials.username,
    credentials.password,
    credentials.allowInsecure,
  );

  const filed = buildFiledPath(request.filing, request.context);
  // ensureDirectory walks the tree creating each level, so a brand-new
  // "/Highlights/2026/09/Some Book" costs one call and no bookkeeping here.
  if (filed.dir !== "/") await client.ensureDirectory(filed.dir);

  let target: FiledPath = filed;
  if ((request.conflict ?? "keepBoth") === "keepBoth") {
    target = await resolveCollision(filed, (path) => client.exists(path));
  }

  await client.put(target.path, request.content, mimeTypeFor(request.format));
  return { path: target.path, renamed: target.path !== filed.path };
}
