/**
 * RegionCaptureOverlay — draw a box over a frozen page and read what is in it.
 *
 * The page underneath is a still image by the time this appears, which is the
 * point: the drawing has to stay put while a finger is dragged across it, and
 * a live WebView would scroll, zoom, or follow a link instead.
 *
 * Coordinates are converted to the capture's own pixels here rather than in the
 * caller, because only this component knows how the image was fitted to the
 * screen. Everything downstream works in image pixels.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { LayoutChangeEvent } from "react-native";

import { fontSize as fs, radius, spacing, useColors } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";

export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  uri: string;
  /** Pixel size of the capture, needed to map the drawn box onto it. */
  imageWidth: number;
  imageHeight: number;
  busy?: boolean;
  onSelect: (region: CaptureRegion) => void;
  onCancel: () => void;
}

/** Smaller than this and it was a tap, not a box. */
const MIN_DRAG = 12;

export function RegionCaptureOverlay({
  uri,
  imageWidth,
  imageHeight,
  busy,
  onSelect,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const boxRef = useRef(box);
  boxRef.current = box;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFrame({ width, height });
  }, []);

  /** How the capture is fitted inside the frame, so touches can be mapped back. */
  const fit = useMemo(() => {
    if (!frame.width || !frame.height || !imageWidth || !imageHeight) {
      return { scale: 1, offsetX: 0, offsetY: 0 };
    }
    const scale = Math.min(frame.width / imageWidth, frame.height / imageHeight);
    return {
      scale,
      offsetX: (frame.width - imageWidth * scale) / 2,
      offsetY: (frame.height - imageHeight * scale) / 2,
    };
  }, [frame, imageWidth, imageHeight]);

  const toImagePixels = useCallback(
    (rect: { x0: number; y0: number; x1: number; y1: number }): CaptureRegion => {
      const left = Math.min(rect.x0, rect.x1);
      const top = Math.min(rect.y0, rect.y1);
      const right = Math.max(rect.x0, rect.x1);
      const bottom = Math.max(rect.y0, rect.y1);
      const px = (value: number, offset: number, limit: number) =>
        Math.round(Math.min(Math.max((value - offset) / fit.scale, 0), limit));
      const x = px(left, fit.offsetX, imageWidth);
      const y = px(top, fit.offsetY, imageHeight);
      return {
        x,
        y,
        width: px(right, fit.offsetX, imageWidth) - x,
        height: px(bottom, fit.offsetY, imageHeight) - y,
      };
    },
    [fit, imageWidth, imageHeight],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          setBox({ x0: locationX, y0: locationY, x1: locationX, y1: locationY });
        },
        onPanResponderMove: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          setBox((prev) => (prev ? { ...prev, x1: locationX, y1: locationY } : prev));
        },
        onPanResponderRelease: () => {
          const current = boxRef.current;
          if (!current) return;
          const dragged =
            Math.abs(current.x1 - current.x0) > MIN_DRAG &&
            Math.abs(current.y1 - current.y0) > MIN_DRAG;
          if (!dragged) {
            setBox(null);
            return;
          }
          onSelect(toImagePixels(current));
        },
      }),
    [onSelect, toImagePixels],
  );

  const drawn = box
    ? {
        left: Math.min(box.x0, box.x1),
        top: Math.min(box.y0, box.y1),
        width: Math.abs(box.x1 - box.x0),
        height: Math.abs(box.y1 - box.y0),
      }
    : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.root} onLayout={onLayout} {...responder.panHandlers}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        <View style={s.scrim} pointerEvents="none" />
        {drawn ? <View style={[s.box, drawn]} pointerEvents="none" /> : null}

        <View style={s.hintBar} pointerEvents="box-none">
          {busy ? (
            <View style={s.busy}>
              <ActivityIndicator color={colors.primaryForeground} />
              <Text style={s.hint}>{t("web.ocrReading", "Reading the text…")}</Text>
            </View>
          ) : (
            <Text style={s.hint}>
              {t("web.ocrHint", "Drag a box around the text you want to read.")}
            </Text>
          )}
          <TouchableOpacity style={s.cancel} onPress={onCancel} disabled={busy}>
            <Text style={s.cancelText}>{t("common.cancel", "Cancel")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: "#000",
    },
    // Dimmed so the drawn box reads as the live part of the picture.
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.35)",
    },
    box: {
      position: "absolute",
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: "rgba(255,255,255,0.16)",
      borderRadius: 2,
    },
    hintBar: {
      position: "absolute",
      left: spacing.lg,
      right: spacing.lg,
      bottom: spacing.xl,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: "rgba(0,0,0,0.72)",
      borderRadius: radius.lg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    busy: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      flex: 1,
    },
    hint: {
      color: "#fff",
      fontSize: fs.sm,
      flexShrink: 1,
    },
    cancel: {
      marginLeft: "auto",
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    cancelText: {
      color: "#fff",
      fontSize: fs.sm,
      opacity: 0.8,
    },
  });
