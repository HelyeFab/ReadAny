import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";

export interface RecognizeOptions {
  /** Local file path of the capture. */
  uri: string;
  /**
   * Crop rectangle as fractions of the image, 0..1. Omit to read the whole
   * image. Fractions rather than pixels because only the native side knows the
   * decoded bitmap's true size; see the module for why that matters.
   */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  language?: "japanese" | "latin";
}

export interface RecognizeResult {
  /** Everything found, in the recogniser's reading order. */
  text: string;
  /** The same text split into blocks, which is roughly one per paragraph. */
  blocks: string[];
}

declare class MlkitOcrModule extends NativeModule {
  recognize(options: RecognizeOptions): Promise<RecognizeResult>;
  /** The same crop as a base64 JPEG, unprocessed, for a vision model to read. */
  cropToBase64(options: RecognizeOptions): Promise<string>;
}

/**
 * On anything but Android there is no recogniser, and a page of images simply
 * has no text in it. Callers check `isAvailable` rather than catching.
 */
const unavailable = {
  recognize: async () => ({ text: "", blocks: [] }),
  cropToBase64: async () => "",
} as unknown as MlkitOcrModule;

let resolved: MlkitOcrModule = unavailable;
let available = false;

if (Platform.OS === "android") {
  try {
    resolved = requireNativeModule<MlkitOcrModule>("MlkitOcr");
    available = true;
  } catch {
    resolved = unavailable;
  }
}

export const isOcrAvailable = available;

export async function recognizeRegion(options: RecognizeOptions): Promise<RecognizeResult> {
  return resolved.recognize(options);
}

export async function cropRegionToBase64(options: RecognizeOptions): Promise<string> {
  return resolved.cropToBase64(options);
}

export default resolved;
