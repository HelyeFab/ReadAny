import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";

export interface RecognizeOptions {
  /** Local file path of the capture. */
  uri: string;
  /** Crop rectangle in the capture's own pixels. Omit to read the whole image. */
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
}

/**
 * On anything but Android there is no recogniser, and a page of images simply
 * has no text in it. Callers check `isAvailable` rather than catching.
 */
const unavailable = {
  recognize: async () => ({ text: "", blocks: [] }),
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

export default resolved;
