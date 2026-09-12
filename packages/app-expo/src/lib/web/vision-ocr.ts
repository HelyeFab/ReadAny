/**
 * Reading a page image through the vision model, via Sensei's own service.
 *
 * The on-device recogniser was built for typeset text and does badly on the
 * material the region reader is actually pointed at: hand lettering, vertical
 * columns, artwork behind the characters. On one cover it read かがみの孤城 as
 * かがるの孤城, and a small label as nonsense.
 *
 * The request goes to the /ocr path on the reader's own endpoint, which
 * deliberately does not wear Sensei's teaching contract — a crop sent through
 * that comes back as a small lesson about the page rather than a transcript of
 * it. The key already configured for chat is the key used here; nothing new to
 * set up.
 *
 * On-device stays as the fallback, so a train with no signal still reads.
 */
import { cropRegionToBase64 } from "../../../modules/mlkit-ocr";
import { cachedTranscript, ocrCacheKey, storeTranscript } from "./ocr-cache";

export interface VisionOcrConfig {
  baseUrl: string;
  apiKey: string;
}

export interface VisionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The chat base URL usually ends in /v1; the transcription path sits beside it
 * rather than under it.
 */
export function ocrUrlFor(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\s+/g, "").replace(/\/+$/, "");
  const root = trimmed.replace(/\/v\d+$/, "");
  return `${root}/ocr`;
}

/** Whether this endpoint is one that can transcribe, rather than only chat. */
export function supportsVisionOcr(baseUrl: string | undefined): boolean {
  return Boolean(baseUrl && /sensei-read/.test(baseUrl));
}

export async function readRegionWithVision(
  captureUri: string,
  region: VisionRegion,
  config: VisionOcrConfig,
  signal?: AbortSignal,
): Promise<string> {
  const image = await cropRegionToBase64({ uri: captureUri, ...region });
  if (!image) throw new Error("The crop could not be prepared.");

  // The same pixels always say the same thing, so a box read twice is free.
  let key = "";
  try {
    key = await ocrCacheKey(image);
    const remembered = cachedTranscript(key);
    if (remembered) return remembered;
  } catch {
    // A cache that will not answer is not a reason to stop reading.
  }

  const response = await fetch(ocrUrlFor(config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ image }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Transcription failed (${response.status}). ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as { text?: string };
  const text = (data.text || "").trim();
  if (key && text) storeTranscript(key, text);
  return text;
}
