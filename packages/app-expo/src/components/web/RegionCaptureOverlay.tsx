/**
 * RegionCaptureOverlay — draw a box over a frozen page and read what is in it.
 *
 * The page underneath is a still image by the time this appears, which is the
 * point: the drawing has to stay put while a finger is dragged across it, and a
 * live WebView would scroll, zoom, or follow a link instead.
 *
 * Drawing does not commit. A box you let go of stays on screen, can be moved by
 * dragging its middle and resized by dragging a corner, and is only read when
 * Read is tapped. Recognition takes a few seconds, so spending them on a box
 * that was a pixel short is a bad trade.
 *
 * The rectangle leaves here as fractions of the image rather than pixels. This
 * component lays the capture out in density-independent units and cannot know
 * the bitmap's true pixel size, so converting here would be guesswork — and
 * guessing wrong crops a different part of the page than the one you drew on.
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

import { CheckIcon } from "@/components/ui/Icon";
import { fontSize as fs, radius, spacing, useColors } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";

/** Crop rectangle as fractions of the capture, 0..1. */
export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  uri: string;
  /** Only the aspect ratio is used, so the units these arrive in do not matter. */
  imageWidth: number;
  imageHeight: number;
  busy?: boolean;
  onSelect: (region: CaptureRegion) => void;
  onCancel: () => void;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Smaller than this and it was a tap, not a box. */
const MIN_SIZE = 24;
/** How close to a corner counts as grabbing it. Generous, for a fingertip. */
const HANDLE_GRAB = 44;
const HANDLE_SIZE = 22;

type Corner = "tl" | "tr" | "bl" | "br";
type Mode = { kind: "draw"; anchorX: number; anchorY: number } | { kind: "move" } | { kind: "resize"; corner: Corner };

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
  const [box, setBox] = useState<Box | null>(null);

  // Gestures read and write through refs: a pan updates many times per second
  // and each handler needs the values as they are now, not as they were when
  // the responder was created.
  const boxRef = useRef<Box | null>(null);
  boxRef.current = box;
  const originRef = useRef({ x: 0, y: 0 });
  const startRef = useRef<{ box: Box; pageX: number; pageY: number } | null>(null);
  const modeRef = useRef<Mode>({ kind: "draw", anchorX: 0, anchorY: 0 });
  const fitRef = useRef({ left: 0, top: 0, width: 0, height: 0 });

  /**
   * Where the action bar sits, so the drawing gesture can keep its hands off it.
   * The responder below claims movement anywhere, which otherwise lets it steal
   * a tap on Read out from under the button and draw a box on the button
   * instead — the touch never reaches it and nothing is ever sent.
   */
  const barRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const onBarLayout = useCallback((event: LayoutChangeEvent) => {
    barRef.current = event.nativeEvent.layout;
  }, []);

  const inBar = useCallback((x: number, y: number) => {
    const b = barRef.current;
    if (!b.width || !b.height) return false;
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
  }, []);

  const containerRef = useRef<View>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFrame({ width, height });
    // Page coordinates are the only touch numbers that are reliable through a
    // drag, so the overlay's own position on screen has to be known.
    containerRef.current?.measureInWindow((x, y) => {
      originRef.current = { x, y };
    });
  }, []);

  /** Where the capture actually sits inside the overlay, preserving its aspect. */
  const fit = useMemo(() => {
    if (!frame.width || !frame.height || !imageWidth || !imageHeight) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    const scale = Math.min(frame.width / imageWidth, frame.height / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return {
      left: (frame.width - width) / 2,
      top: (frame.height - height) / 2,
      width,
      height,
    };
  }, [frame, imageWidth, imageHeight]);
  fitRef.current = fit;

  const clampToImage = useCallback((next: Box): Box => {
    const f = fitRef.current;
    if (!f.width || !f.height) return next;
    const width = Math.min(next.width, f.width);
    const height = Math.min(next.height, f.height);
    return {
      width,
      height,
      left: Math.min(Math.max(next.left, f.left), f.left + f.width - width),
      top: Math.min(Math.max(next.top, f.top), f.top + f.height - height),
    };
  }, []);

  const cornerAt = useCallback((current: Box, x: number, y: number): Corner | null => {
    const corners: [Corner, number, number][] = [
      ["tl", current.left, current.top],
      ["tr", current.left + current.width, current.top],
      ["bl", current.left, current.top + current.height],
      ["br", current.left + current.width, current.top + current.height],
    ];
    for (const [corner, cx, cy] of corners) {
      if (Math.abs(x - cx) <= HANDLE_GRAB && Math.abs(y - cy) <= HANDLE_GRAB) return corner;
    }
    return null;
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) =>
          !inBar(
            event.nativeEvent.pageX - originRef.current.x,
            event.nativeEvent.pageY - originRef.current.y,
          ),
        onMoveShouldSetPanResponder: (event) =>
          !inBar(
            event.nativeEvent.pageX - originRef.current.x,
            event.nativeEvent.pageY - originRef.current.y,
          ),
        onPanResponderGrant: (event) => {
          const x = event.nativeEvent.pageX - originRef.current.x;
          const y = event.nativeEvent.pageY - originRef.current.y;
          const current = boxRef.current;

          if (current) {
            const corner = cornerAt(current, x, y);
            if (corner) {
              modeRef.current = { kind: "resize", corner };
              startRef.current = { box: current, pageX: x, pageY: y };
              return;
            }
            const inside =
              x >= current.left &&
              x <= current.left + current.width &&
              y >= current.top &&
              y <= current.top + current.height;
            if (inside) {
              modeRef.current = { kind: "move" };
              startRef.current = { box: current, pageX: x, pageY: y };
              return;
            }
          }

          // Anywhere else starts a fresh box, replacing any previous one.
          modeRef.current = { kind: "draw", anchorX: x, anchorY: y };
          startRef.current = null;
          setBox({ left: x, top: y, width: 0, height: 0 });
        },
        onPanResponderMove: (event) => {
          const x = event.nativeEvent.pageX - originRef.current.x;
          const y = event.nativeEvent.pageY - originRef.current.y;
          const mode = modeRef.current;

          if (mode.kind === "draw") {
            setBox(
              clampToImage({
                left: Math.min(mode.anchorX, x),
                top: Math.min(mode.anchorY, y),
                width: Math.abs(x - mode.anchorX),
                height: Math.abs(y - mode.anchorY),
              }),
            );
            return;
          }

          const start = startRef.current;
          if (!start) return;
          const dx = x - start.pageX;
          const dy = y - start.pageY;

          if (mode.kind === "move") {
            setBox(clampToImage({ ...start.box, left: start.box.left + dx, top: start.box.top + dy }));
            return;
          }

          const { corner } = mode;
          let { left, top, width, height } = start.box;
          if (corner === "tl" || corner === "bl") {
            left = start.box.left + dx;
            width = start.box.width - dx;
          } else {
            width = start.box.width + dx;
          }
          if (corner === "tl" || corner === "tr") {
            top = start.box.top + dy;
            height = start.box.height - dy;
          } else {
            height = start.box.height + dy;
          }
          // Dragging a corner past its opposite flips the box rather than
          // collapsing it to nothing.
          if (width < 0) {
            left += width;
            width = -width;
          }
          if (height < 0) {
            top += height;
            height = -height;
          }
          setBox(clampToImage({ left, top, width, height }));
        },
        onPanResponderRelease: () => {
          const current = boxRef.current;
          if (current && (current.width < MIN_SIZE || current.height < MIN_SIZE)) {
            setBox(null);
          }
        },
      }),
    [clampToImage, cornerAt, inBar],
  );

  const readBox = useCallback(() => {
    const current = boxRef.current;
    const f = fitRef.current;
    if (!current || !f.width || !f.height) return;
    onSelect({
      x: (current.left - f.left) / f.width,
      y: (current.top - f.top) / f.height,
      width: current.width / f.width,
      height: current.height / f.height,
    });
  }, [onSelect]);

  const ready = Boolean(box && box.width >= MIN_SIZE && box.height >= MIN_SIZE);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View ref={containerRef} style={s.root} onLayout={onLayout} {...responder.panHandlers}>
        <Image
          source={{ uri }}
          style={{ position: "absolute", ...fit }}
          resizeMode="stretch"
        />

        {/* Dim everything except the box, so the part being read stays legible. */}
        {box ? (
          <>
            <View style={[s.dim, { left: 0, right: 0, top: 0, height: Math.max(box.top, 0) }]} />
            <View style={[s.dim, { left: 0, right: 0, top: box.top + box.height, bottom: 0 }]} />
            <View style={[s.dim, { left: 0, width: Math.max(box.left, 0), top: box.top, height: box.height }]} />
            <View style={[s.dim, { left: box.left + box.width, right: 0, top: box.top, height: box.height }]} />
            <View style={[s.box, box]} pointerEvents="none">
              <View style={[s.handle, { left: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2 }]} />
              <View style={[s.handle, { right: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2 }]} />
              <View style={[s.handle, { left: -HANDLE_SIZE / 2, bottom: -HANDLE_SIZE / 2 }]} />
              <View style={[s.handle, { right: -HANDLE_SIZE / 2, bottom: -HANDLE_SIZE / 2 }]} />
            </View>
          </>
        ) : (
          <View style={s.dimAll} pointerEvents="none" />
        )}

        <View style={s.bar} onLayout={onBarLayout} pointerEvents="box-none">
          {busy ? (
            <View style={s.busy}>
              <ActivityIndicator color="#fff" />
              <Text style={s.hint}>{t("web.ocrReading", "Reading the text…")}</Text>
            </View>
          ) : (
            <Text style={s.hint}>
              {ready
                ? t("web.ocrAdjust", "Drag to move, or a corner to resize. Then tap Read.")
                : t("web.ocrHint", "Drag a box around the text you want to read.")}
            </Text>
          )}
          <TouchableOpacity style={s.cancel} onPress={onCancel} disabled={busy}>
            <Text style={s.cancelText}>{t("common.cancel", "Cancel")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.read, !ready || busy ? s.readDisabled : null]}
            onPress={readBox}
            disabled={!ready || busy}
          >
            <CheckIcon size={16} color={colors.primaryForeground} />
            <Text style={s.readText}>{t("web.ocrRead", "Read")}</Text>
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
    dim: {
      position: "absolute",
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    dimAll: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.35)",
    },
    box: {
      position: "absolute",
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 2,
    },
    handle: {
      position: "absolute",
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
      borderRadius: HANDLE_SIZE / 2,
      backgroundColor: colors.primary,
      borderWidth: 2,
      borderColor: "#fff",
    },
    bar: {
      position: "absolute",
      left: spacing.lg,
      right: spacing.lg,
      bottom: spacing.xl,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: "rgba(0,0,0,0.78)",
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
      flex: 1,
      flexShrink: 1,
    },
    cancel: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    cancelText: {
      color: "#fff",
      fontSize: fs.sm,
      opacity: 0.75,
    },
    read: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    readDisabled: {
      opacity: 0.4,
    },
    readText: {
      color: colors.primaryForeground,
      fontSize: fs.sm,
      fontWeight: "600",
    },
  });
