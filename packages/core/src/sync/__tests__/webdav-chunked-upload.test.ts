import { describe, expect, it } from "vitest";
import {
  CHUNKED_UPLOAD_THRESHOLD,
  DEFAULT_CHUNK_SIZE,
  chunkName,
  deriveUploadsRoot,
  isPayloadTooLarge,
  newUploadId,
  planChunks,
  shouldChunk,
} from "../webdav-chunked-upload";

const MB = 1024 * 1024;

describe("deriveUploadsRoot", () => {
  it("finds the upload endpoint beside the files root", () => {
    expect(deriveUploadsRoot("https://cloud.example.com/remote.php/dav/files/helye")).toBe(
      "https://cloud.example.com/remote.php/dav/uploads/helye",
    );
  });

  it("works when the configured url points inside a folder", () => {
    expect(deriveUploadsRoot("https://cloud.example.com/remote.php/dav/files/helye/ReadAny")).toBe(
      "https://cloud.example.com/remote.php/dav/uploads/helye",
    );
  });

  it("returns null for a server that is not Nextcloud-shaped", () => {
    // A generic WebDAV server has no upload session endpoint, and guessing one
    // would turn a working plain PUT into a 404.
    expect(deriveUploadsRoot("https://dav.example.com/webdav")).toBeNull();
    expect(deriveUploadsRoot("https://example.com/remote.php/dav")).toBeNull();
  });
});

describe("planChunks", () => {
  it("covers the file exactly, with no gap and no overlap", () => {
    const total = 298 * MB + 7;
    const chunks = planChunks(total);

    expect(chunks[0].offset).toBe(0);
    let seen = 0;
    for (const [i, c] of chunks.entries()) {
      if (i > 0) expect(c.offset).toBe(chunks[i - 1].offset + chunks[i - 1].length);
      seen += c.length;
    }
    expect(seen).toBe(total);
    const last = chunks[chunks.length - 1];
    expect(last.offset + last.length).toBe(total);
  });

  it("keeps every chunk under the limit that caused this", () => {
    for (const c of planChunks(298 * MB)) {
      expect(c.length).toBeLessThan(100 * MB);
    }
  });

  it("handles a file smaller than one chunk", () => {
    expect(planChunks(10)).toEqual([{ index: 0, offset: 0, length: 10 }]);
  });

  it("has nothing to do for an empty file", () => {
    expect(planChunks(0)).toEqual([]);
  });
});

describe("chunkName", () => {
  it("pads so chunks sort in order as strings", () => {
    const names = [0, 1, 9, 10, 99, 100].map(chunkName);
    expect(names).toEqual(["00001", "00002", "00010", "00011", "00100", "00101"]);
    // The server assembles in name order; unpadded names would put 10 before 2.
    expect([...names].sort()).toEqual(names);
  });
});

describe("shouldChunk", () => {
  it("leaves ordinary books alone", () => {
    expect(shouldChunk(5 * MB)).toBe(false);
    expect(shouldChunk(CHUNKED_UPLOAD_THRESHOLD)).toBe(false);
  });

  it("chunks the files that were failing", () => {
    for (const size of [102.9, 120, 147.8, 298.4]) {
      expect(shouldChunk(Math.round(size * MB))).toBe(true);
    }
  });

  it("says no when the size is unknown, rather than guessing", () => {
    expect(shouldChunk(null)).toBe(false);
    expect(shouldChunk(undefined)).toBe(false);
  });

  it("uses a chunk size with headroom under the 100 MB ceiling", () => {
    expect(DEFAULT_CHUNK_SIZE).toBeLessThan(100 * MB);
  });
});

describe("isPayloadTooLarge", () => {
  it("recognises the rejection Cloudflare actually sends", () => {
    expect(isPayloadTooLarge(new Error("WebDAV PUT failed for /x: 413 Payload Too Large"))).toBe(
      true,
    );
    expect(isPayloadTooLarge({ status: 413 })).toBe(true);
    expect(isPayloadTooLarge(new Error("Request Entity Too Large"))).toBe(true);
  });

  it("does not mistake other failures for it", () => {
    expect(isPayloadTooLarge(new Error("404 Not Found"))).toBe(false);
    expect(isPayloadTooLarge(new Error("Network request failed"))).toBe(false);
    expect(isPayloadTooLarge(null)).toBe(false);
  });
});

describe("newUploadId", () => {
  it("does not collide when two devices upload at once", () => {
    const ids = new Set(Array.from({ length: 500 }, newUploadId));
    expect(ids.size).toBe(500);
  });
});
