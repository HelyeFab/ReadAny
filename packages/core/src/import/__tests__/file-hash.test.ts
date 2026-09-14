import { describe, expect, it, vi } from "vitest";

import { type ChunkedFileReader, hashFileSha256 } from "../file-hash";

/** Known-answer vectors, so a refactor cannot quietly change what a hash means. */
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

/** A reader over an in-memory buffer, serving at most `maxRead` bytes per call. */
function createReader(bytes: Uint8Array, maxRead = Number.POSITIVE_INFINITY): ChunkedFileReader {
  return {
    size: bytes.length,
    readRange: async (offset, length) => bytes.subarray(offset, offset + Math.min(length, maxRead)),
  };
}

function textReader(text: string, maxRead?: number): ChunkedFileReader {
  return createReader(new TextEncoder().encode(text), maxRead);
}

/** Deterministic pseudo-random bytes — a stand-in for a real book's contents. */
function pseudoRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = seed & 0xff;
  }
  return out;
}

const immediately = () => Promise.resolve();

describe("hashFileSha256", () => {
  it("matches the known SHA-256 of an empty file", async () => {
    expect(await hashFileSha256(textReader(""))).toBe(EMPTY_SHA256);
  });

  it("matches the known SHA-256 of a short file", async () => {
    expect(await hashFileSha256(textReader("abc"))).toBe(ABC_SHA256);
  });

  it("returns lowercase hex", async () => {
    const hash = await hashFileSha256(textReader("abc"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the same hash whatever the chunk size", async () => {
    const bytes = pseudoRandomBytes(10_000);
    const expected = await hashFileSha256(createReader(bytes), {
      chunkBytes: 10_000,
      yieldBetweenChunks: immediately,
    });

    for (const chunkBytes of [1, 7, 512, 9_999, 1_000_000]) {
      const actual = await hashFileSha256(createReader(bytes), {
        chunkBytes,
        yieldBetweenChunks: immediately,
      });
      expect(actual, `chunkBytes=${chunkBytes}`).toBe(expected);
    }
  });

  it("is unaffected by a reader that serves short reads", async () => {
    const bytes = pseudoRandomBytes(5_000);
    const whole = await hashFileSha256(createReader(bytes), { yieldBetweenChunks: immediately });
    const dribbled = await hashFileSha256(createReader(bytes, 13), {
      chunkBytes: 1024,
      yieldBetweenChunks: immediately,
    });

    expect(dribbled).toBe(whole);
  });

  it("distinguishes files that differ by a single byte", async () => {
    const a = pseudoRandomBytes(4_096);
    const b = Uint8Array.from(a);
    b[2_048] ^= 0x01;

    const hashA = await hashFileSha256(createReader(a), { yieldBetweenChunks: immediately });
    const hashB = await hashFileSha256(createReader(b), { yieldBetweenChunks: immediately });

    expect(hashA).not.toBe(hashB);
  });

  it("stops instead of spinning when the file ends early", async () => {
    const readRange = vi.fn(async () => new Uint8Array(0));
    const hash = await hashFileSha256(
      { size: 1_000_000, readRange },
      {
        chunkBytes: 1024,
        yieldBetweenChunks: immediately,
      },
    );

    expect(readRange).toHaveBeenCalledTimes(1);
    expect(hash).toBe(EMPTY_SHA256);
  });

  it("reports progress and yields between chunks, but not after the last one", async () => {
    const progress: Array<[number, number]> = [];
    const onYield = vi.fn(immediately);

    await hashFileSha256(createReader(pseudoRandomBytes(300)), {
      chunkBytes: 100,
      onProgress: (done, total) => progress.push([done, total]),
      yieldBetweenChunks: onYield,
    });

    expect(progress).toEqual([
      [100, 300],
      [200, 300],
      [300, 300],
    ]);
    expect(onYield).toHaveBeenCalledTimes(2);
  });

  it("never reads past the end of the file", async () => {
    const bytes = pseudoRandomBytes(250);
    const reads: Array<[number, number]> = [];
    const reader: ChunkedFileReader = {
      size: bytes.length,
      readRange: async (offset, length) => {
        reads.push([offset, length]);
        return bytes.subarray(offset, offset + length);
      },
    };

    await hashFileSha256(reader, { chunkBytes: 100, yieldBetweenChunks: immediately });

    expect(reads).toEqual([
      [0, 100],
      [100, 100],
      [200, 50],
    ]);
  });

  it("refuses a file of unknown size rather than guessing", async () => {
    const reader = { size: Number.NaN, readRange: async () => new Uint8Array(0) };
    await expect(hashFileSha256(reader)).rejects.toThrow(/unknown size/);
  });

  it("refuses a non-positive chunk size", async () => {
    await expect(hashFileSha256(textReader("abc"), { chunkBytes: 0 })).rejects.toThrow(
      /positive number/,
    );
  });
});
