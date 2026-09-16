/**
 * Guards the one thing about this module that TypeScript cannot.
 *
 * expo-crypto declares `digest(algorithm, data: BufferSource)`, so handing it
 * an ArrayBuffer type-checks perfectly and then fails at the Android bridge,
 * whose binding takes a TypedArray. It failed for every cover on every sync
 * and only ever said so in a console warning.
 */
import { describe, expect, it, vi } from "vitest";

const digest = vi.fn(async (_algorithm: unknown, data: unknown) => {
  // Stand in for the Kotlin binding, which accepts only a TypedArray.
  if (!ArrayBuffer.isView(data)) {
    throw new Error("Cannot convert '[object ArrayBuffer]' to a Kotlin type.");
  }
  const bytes = new Uint8Array(32);
  bytes.fill((data as Uint8Array)[0] ?? 0);
  return bytes.buffer;
});

vi.mock("expo-crypto", () => ({
  digest: (...args: unknown[]) => digest(args[0], args[1]),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));

const fileBytes = new Uint8Array([1, 2, 3, 4]);

vi.mock("expo-file-system", () => ({
  File: class {
    size = fileBytes.byteLength;
    async bytes() {
      return fileBytes;
    }
    open() {
      throw new Error("the chunked walk must not be reached for a small file");
    }
  },
}));

vi.mock("@readany/core", () => ({
  hashFileSha256: async () => "unused",
}));

describe("digestBytes, via the public entry points", () => {
  it("hands the native digest a typed array, not an ArrayBuffer", async () => {
    const { hashFileAtPath } = await import("./file-hash");
    const hash = await hashFileAtPath("/covers/a.jpg");

    expect(digest).toHaveBeenCalledTimes(1);
    const data = digest.mock.calls[0][1];
    expect(ArrayBuffer.isView(data)).toBe(true);
    expect(data).toBeInstanceOf(Uint8Array);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes a small book natively rather than falling back to chunks", async () => {
    digest.mockClear();
    const { hashBookFile } = await import("./file-hash");
    const hash = await hashBookFile("/books/a.epub", fileBytes.byteLength);

    expect(digest).toHaveBeenCalledTimes(1);
    expect(ArrayBuffer.isView(digest.mock.calls[0][1])).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
