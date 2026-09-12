import type { TTSConfig } from "@readany/core/tts";
import { ExpoAVEdgeTTSPlayer } from "./expo-av-edge-player";
import { ExpoSpeechTTSPlayer } from "./expo-speech-player";
import { TrackPlayerCloudTTSPlayer } from "./track-player-cloud-tts-player";

const systemPreviewPlayer = new ExpoSpeechTTSPlayer();
const edgePreviewPlayer = new ExpoAVEdgeTTSPlayer();
const dashscopePreviewPlayer = new ExpoSpeechTTSPlayer();
const cloudPreviewPlayer = new TrackPlayerCloudTTSPlayer();

export interface TTSPreviewCallbacks {
  onError?: (error: unknown) => void;
  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onEnd?: () => void;
}

function stopPlayer(player: { stop: () => void }) {
  try {
    player.stop();
  } catch {}
}

export function stopTTSPreview() {
  stopPlayer(systemPreviewPlayer);
  stopPlayer(edgePreviewPlayer);
  stopPlayer(dashscopePreviewPlayer);
  stopPlayer(cloudPreviewPlayer);
}

export async function previewTTSConfig(
  text: string,
  config: TTSConfig,
  callbacks: TTSPreviewCallbacks = {},
) {
  stopTTSPreview();
  const player =
    config.engine === "edge"
      ? edgePreviewPlayer
      : config.engine === "dashscope"
        ? dashscopePreviewPlayer
        : config.engine === "xiaomi" || config.engine === "openai-compatible"
          ? cloudPreviewPlayer
          : systemPreviewPlayer;
  player.onStateChange = undefined;
  player.onEnd = undefined;
  // Not every preview player declares onError; the cloud one does, and it is
  // the one that can fail on the network.
  (player as { onError?: (error: unknown) => void }).onError = (error: unknown) => {
    callbacks.onError?.(error);
    callbacks.onStateChange?.("stopped");
  };
  try {
    const preview = Promise.resolve(player.speak(text, config));
    player.onStateChange = callbacks.onStateChange;
    player.onEnd = callbacks.onEnd;
    await preview;
  } catch (error) {
    console.error("[TTSPreview] Preview failed", error);
    callbacks.onStateChange?.("stopped");
    // Rethrown so the caller can say WHY. Swallowing it here leaves a preview
    // that looks identical whether the voice played or never loaded.
    throw error;
  }
}
