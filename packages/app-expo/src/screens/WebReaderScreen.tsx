/**
 * WebReaderScreen — read a web page with the same companion the books get.
 *
 * The point of this tab is not browsing. It is that a lot of Japanese worth
 * reading is only ever a web page: today's news, a public-domain novel, a blog
 * post. Loading it here instead of in Chrome means a selection can reach the
 * dictionary, the voice, and Sensei, exactly as it does inside a book.
 *
 * The page itself is left alone. Everything this screen adds lives in React
 * Native chrome around the WebView, and the only thing injected into the
 * document is the selection bridge.
 */
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Animated,
  Image,
  Keyboard,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { captureRef } from "react-native-view-shot";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";

import { DefinitionSheet } from "@/components/reader/DefinitionSheet";
import { ReaderAIChatSheet } from "@/components/reader/ReaderAIChatSheet";
import {
  BookOpenIcon,
  BookmarkFilledIcon,
  BookmarkIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  GlobeIcon,
  LibraryIcon,
  RefreshCwIcon,
  ScanTextIcon,
  ScrollTextIcon,
  SearchIcon,
  XIcon,
} from "@/components/ui/Icon";
import { RegionCaptureOverlay } from "@/components/web/RegionCaptureOverlay";
import type { CaptureRegion } from "@/components/web/RegionCaptureOverlay";
import { WebSelectionBar } from "@/components/web/WebSelectionBar";
import { resolveActiveAIConfig } from "@/lib/ai/resolve-active-ai-config";
import { previewTTSConfig, stopTTSPreview } from "@/lib/platform/tts-preview";
import { colorForUrl, hostOf, initialOf, relativeTime } from "@/lib/web/page-identity";
import { SELECTION_BRIDGE_JS, parseWebBridgeMessage } from "@/lib/web/selection-bridge";
import { STARTER_SITES, resolveInputToUrl } from "@/lib/web/starter-sites";
import { readRegionWithVision, supportsVisionOcr } from "@/lib/web/vision-ocr";
import type { TabParamList } from "@/navigation/TabNavigator";
import { useSettingsStore } from "@/stores";
import { isSavedUrl, useTTSStore, useWebStore } from "@/stores";
import { fontSize as fs, fontWeight as fw, radius, spacing, ui, useColors } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import ReadingSvg from "../../assets/illustrations/reading.svg";
import { isOcrAvailable, recognizeRegion } from "../../modules/mlkit-ocr";

export function WebReaderScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const tabBarHeight = useBottomTabBarHeight();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();

  const webRef = useRef<WebView>(null);
  const {
    lastUrl,
    recent,
    saved,
    savedCollapsed,
    _hasHydrated,
    recordVisit,
    toggleSaved,
    toggleSavedCollapsed,
    removeSaved,
    clearRecent,
    refresh,
  } = useWebStore();
  const ttsConfig = useTTSStore((state) => state.config);

  const [url, setUrl] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [definition, setDefinition] = useState<{ word: string } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  /**
   * A still of the page, taken so a box can be drawn on it. Some of the best
   * Japanese on the web is published as page images with no text to select;
   * reading those means recognising the crop instead.
   */
  const pageRef = useRef<View>(null);
  const [capture, setCapture] = useState<{ uri: string; width: number; height: number } | null>(
    null,
  );
  const [capturePurpose, setCapturePurpose] = useState<"read" | "ai">("read");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [pendingAIPrompt, setPendingAIPrompt] = useState<{ id: string; text: string } | null>(null);
  const [webPageContext, setWebPageContext] = useState("");
  const [domPageContext, setDomPageContext] = useState("");
  const [fullPageContext, setFullPageContext] = useState("");
  const backgroundTranscriptRef = useRef<{ uri: string; text: string } | null>(null);
  const [showAIMenu, setShowAIMenu] = useState(false);
  const initialBubblePosition = useMemo(
    () => ({ x: Math.max(8, windowWidth - 68), y: Math.max(80, windowHeight - tabBarHeight - 92) }),
    [tabBarHeight, windowHeight, windowWidth],
  );
  const bubblePosition = useRef(new Animated.ValueXY(initialBubblePosition)).current;
  const bubbleCoordinatesRef = useRef(initialBubblePosition);
  const [bubbleCoordinates, setBubbleCoordinates] = useState(initialBubblePosition);

  const clampBubble = useCallback(
    (x: number, y: number) => ({
      x: Math.max(8, Math.min(windowWidth - 60, x)),
      y: Math.max(8, Math.min(windowHeight - tabBarHeight - 60, y)),
    }),
    [tabBarHeight, windowHeight, windowWidth],
  );

  const aiBubblePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) + Math.abs(gesture.dy) > 3,
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          Math.abs(gesture.dx) + Math.abs(gesture.dy) > 3,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          setShowAIMenu(false);
        },
        onPanResponderMove: (_event, gesture) => {
          const start = bubbleCoordinatesRef.current;
          const next = clampBubble(start.x + gesture.dx, start.y + gesture.dy);
          bubblePosition.setValue(next);
        },
        onPanResponderRelease: (_event, gesture) => {
          const moved = Math.hypot(gesture.dx, gesture.dy) > 8;
          const start = bubbleCoordinatesRef.current;
          const next = moved ? clampBubble(start.x + gesture.dx, start.y + gesture.dy) : start;
          bubbleCoordinatesRef.current = next;
          bubblePosition.setValue(next);
          setBubbleCoordinates(next);
          if (!moved) setShowAIMenu((visible) => !visible);
        },
        onPanResponderTerminate: () => {
          bubblePosition.setValue(bubbleCoordinatesRef.current);
        },
      }),
    [bubblePosition, clampBubble],
  );

  useEffect(() => {
    const next = clampBubble(bubbleCoordinatesRef.current.x, bubbleCoordinatesRef.current.y);
    bubbleCoordinatesRef.current = next;
    bubblePosition.setValue(next);
    setBubbleCoordinates(next);
  }, [bubblePosition, clampBubble]);

  const captureWebPageContext = useCallback(() => {
    webRef.current?.injectJavaScript(`
      (function () {
        try {
          var text = String(document.body && document.body.innerText || '')
            .replace(/\\s+/g, ' ')
            .trim()
            .slice(0, 12000);
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'readany-page-context',
            text: text
          }));
        } catch (_) {}
      })();
      true;
    `);
  }, []);

  const openWebChat = useCallback(() => {
    setShowAIMenu(false);
    captureWebPageContext();
    setWebPageContext(
      fullPageContext
        ? `[Complete current page transcript]\n${fullPageContext}`
        : domPageContext
          ? `[Current web page text]\n${domPageContext}`
          : "The user opened chat while viewing the current web page.",
    );
    setShowAIChat(true);
  }, [captureWebPageContext, domPageContext, fullPageContext]);

  // Reopen whatever was being read, but only once the persisted state has
  // actually arrived — reading `lastUrl` before that always looks like "empty".
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!_hasHydrated || restoredRef.current) return;
    restoredRef.current = true;
    // Hand any device-local pages to the database, then read the shelf back
    // out of it — this is also what picks up pages another device saved.
    void refresh();
    if (lastUrl) {
      setUrl(lastUrl);
      setAddress(lastUrl);
    }
  }, [_hasHydrated, lastUrl, refresh]);

  useEffect(() => () => stopTTSPreview(), []);

  const open = useCallback((target: string) => {
    const resolved = resolveInputToUrl(target);
    if (!resolved) return;
    Keyboard.dismiss();
    setSelection(null);
    setUrl(resolved);
    setAddress(resolved);
  }, []);

  const closePage = useCallback(() => {
    setSelection(null);
    setUrl(null);
    setAddress("");
    setPageTitle("");
    stopTTSPreview();
    setSpeaking(false);
  }, []);

  const handleMessage = useCallback(
    (raw: string) => {
      try {
        const contextMessage = JSON.parse(raw) as { type?: string; text?: string };
        if (contextMessage.type === "readany-page-context") {
          setDomPageContext(contextMessage.text?.trim() || "");
          return;
        }
      } catch {
        // Selection bridge messages are parsed below.
      }
      const message = parseWebBridgeMessage(raw);
      if (!message) return;
      if (message.type === "selection") {
        setSelection(message.text);
        return;
      }
      if (message.type === "selectionCleared") {
        setSelection(null);
        return;
      }
      if (message.type === "page") {
        setPageTitle(message.title);
        recordVisit({ url: message.url, title: message.title });
      }
    },
    [recordVisit],
  );

  const handleNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
    setCanGoForward(nav.canGoForward);
    if (nav.url && !nav.loading) setAddress(nav.url);
  }, []);

  const speakSelection = useCallback(() => {
    if (!selection) return;
    setSpeaking(true);
    previewTTSConfig(selection, ttsConfig, {
      onStateChange: (state) => {
        if (state === "stopped") setSpeaking(false);
      },
      onEnd: () => setSpeaking(false),
      onError: (error) => {
        setSpeaking(false);
        Alert.alert(
          t("tts.previewFailed", "Speech failed"),
          error instanceof Error ? error.message : String(error),
        );
      },
    }).catch((error) => {
      setSpeaking(false);
      Alert.alert(
        t("tts.previewFailed", "Speech failed"),
        error instanceof Error ? error.message : String(error),
      );
    });
  }, [selection, ttsConfig, t]);

  const askSensei = useCallback(() => {
    if (!selection) return;
    setWebPageContext(
      `${fullPageContext ? `[Complete current page transcript]\n${fullPageContext}\n\n` : ""}[User-selected focus]\n${selection}`,
    );
    setSelection(null);
    setShowAIChat(true);
  }, [fullPageContext, selection]);

  const transcribeCapture = useCallback(
    async (
      snapshot: { uri: string; width: number; height: number },
      region: CaptureRegion,
      traceId: string,
      scope: "page" | "selection",
    ) => {
      let visionText = "";
      let deviceText = "";
      const aiConfig = await resolveActiveAIConfig(useSettingsStore.getState());
      const endpoint = aiConfig?.endpoints.find((entry) => entry.id === aiConfig.activeEndpointId);
      const visionPromise = async () => {
        if (!endpoint?.apiKey || !supportsVisionOcr(endpoint.baseUrl)) return "";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
          const result = await readRegionWithVision(
            snapshot.uri,
            region,
            { baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey },
            controller.signal,
          );
          console.info(
            "[WebAIRegion] vision-complete",
            JSON.stringify({ traceId, scope, length: result.length }),
          );
          return result;
        } catch (error) {
          console.warn("[OCR] vision read failed, falling back on-device", error);
          return "";
        } finally {
          clearTimeout(timeout);
        }
      };
      const devicePromise = async () => {
        if (!isOcrAvailable) return "";
        const result = await recognizeRegion({
          uri: snapshot.uri,
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          language: "japanese",
        });
        const orderedText = result.blocks.filter(Boolean).join("\n") || result.text;
        console.info(
          "[WebAIRegion] device-complete",
          JSON.stringify({ traceId, scope, length: orderedText.length, blocks: result.blocks }),
        );
        return orderedText;
      };
      [visionText, deviceText] = await Promise.all([visionPromise(), devicePromise()]);
      const contentLength = (value: string) => value.replace(/\s+/g, "").length;
      const text = contentLength(deviceText) > contentLength(visionText) ? deviceText : visionText;
      console.info(
        "[WebAIRegion] ocr",
        JSON.stringify({
          traceId,
          scope,
          chosen: text === deviceText ? "device" : "vision",
          visionLength: contentLength(visionText),
          deviceLength: contentLength(deviceText),
          visionText: visionText.slice(0, 2000),
          deviceText: deviceText.slice(0, 2000),
        }),
      );
      return text.trim();
    },
    [],
  );

  /** Freeze the page as an image so a box can be drawn on it without it moving. */
  const startRegionCapture = useCallback(
    async (purpose: "read" | "ai" = "read") => {
      if (!pageRef.current) return;
      setSelection(null);
      setCapturePurpose(purpose);
      try {
        const raw = await captureRef(pageRef, { format: "png", quality: 1, result: "tmpfile" });
        const uri = raw.startsWith("file://") ? raw : `file://${raw}`;
        const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
        });
        console.info(
          "[WebAIRegion] capture",
          JSON.stringify({ purpose, uri, width: size.width, height: size.height, page: address }),
        );
        const snapshot = { uri, width: size.width, height: size.height };
        setCapture(snapshot);
        if (purpose === "ai") {
          const traceId = `web-ai-page-${Date.now()}`;
          void transcribeCapture(snapshot, { x: 0, y: 0, width: 1, height: 1 }, traceId, "page")
            .then((text) => {
              if (!text) return;
              backgroundTranscriptRef.current = { uri, text };
              setFullPageContext(text);
            })
            .catch((error) => console.warn("[WebAIRegion] background page OCR failed", error));
        }
      } catch (error) {
        Alert.alert(
          t("web.captureFailed", "Could not capture the page"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [address, t, transcribeCapture],
  );

  useEffect(() => {
    if (!url || loading || !pageRef.current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const raw = await captureRef(pageRef, { format: "png", quality: 1, result: "tmpfile" });
          const uri = raw.startsWith("file://") ? raw : `file://${raw}`;
          const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
            Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
          });
          const snapshot = { uri, width: size.width, height: size.height };
          const traceId = `web-ai-background-${Date.now()}`;
          const text = await transcribeCapture(
            snapshot,
            { x: 0, y: 0, width: 1, height: 1 },
            traceId,
            "page",
          );
          if (cancelled || !text) return;
          backgroundTranscriptRef.current = { uri, text };
          setFullPageContext(text);
          console.info(
            "[WebAIRegion] background-ready",
            JSON.stringify({ traceId, page: address, length: text.length }),
          );
        } catch (error) {
          if (!cancelled) console.warn("[WebAIRegion] background page OCR failed", error);
        }
      })();
    }, 900);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address, loading, transcribeCapture, url]);

  const handleRegion = useCallback(
    async (region: CaptureRegion) => {
      if (!capture) return;
      setOcrBusy(true);
      try {
        // The vision model first, because this is only ever pointed at page
        // images and the on-device recogniser is poor on hand lettering. It
        // falls back rather than failing: no signal should still read.
        const traceId = `web-ai-${Date.now()}`;
        console.info(
          "[WebAIRegion] selection",
          JSON.stringify({
            traceId,
            capturePurpose,
            region,
            captureSize: [capture.width, capture.height],
          }),
        );
        const wholePage = region.width >= 0.99 && region.height >= 0.99;
        const selectedPromise = transcribeCapture(
          capture,
          region,
          traceId,
          wholePage ? "page" : "selection",
        );
        const cachedPage = backgroundTranscriptRef.current;
        const pagePromise = wholePage
          ? selectedPromise
          : cachedPage?.uri === capture.uri
            ? Promise.resolve(cachedPage.text)
            : transcribeCapture(
                capture,
                { x: 0, y: 0, width: 1, height: 1 },
                `${traceId}-page`,
                "page",
              );
        const [cleaned, completePageText] = await Promise.all([selectedPromise, pagePromise]);
        console.info(
          "[WebAIRegion] context",
          JSON.stringify({
            traceId,
            cleanedLength: cleaned.length,
            cleaned: cleaned.slice(0, 4000),
          }),
        );
        setCapture(null);
        if (!cleaned) {
          if (capturePurpose === "ai" && region.width >= 0.99 && region.height >= 0.99) {
            setWebPageContext(
              `[Web page text — it may contain site controls; say when the requested content is not present]\n${domPageContext}`,
            );
            setPendingAIPrompt({
              id: traceId,
              text: "Help me understand this manga page. Translate the visible Japanese and explain what is happening.",
            });
            setShowAIChat(true);
            return;
          }
          Alert.alert(
            t("web.ocrNothing", "No text found"),
            t(
              "web.ocrNothingBody",
              "Nothing was recognised in that area. A tighter box around a single line usually works better.",
            ),
          );
          return;
        }
        if (capturePurpose === "ai") {
          const completeContext = completePageText || domPageContext;
          if (completePageText) {
            backgroundTranscriptRef.current = { uri: capture.uri, text: completePageText };
            setFullPageContext(completePageText);
          }
          setWebPageContext(
            `[Complete current page transcript — always use this for surrounding context]\n${completeContext}\n\n${wholePage ? "" : `[User-selected focus — answer specifically about this region]\n${cleaned}`}`,
          );
          setPendingAIPrompt({
            id: traceId,
            text: wholePage
              ? "Help me understand this manga page. Translate the visible Japanese and explain what is happening."
              : "Explain the selected manga text using the complete page for context. Translate it, explain its meaning and nuance, then include a Word breakdown with each Japanese word, its reading, and its individual meaning.",
          });
          setShowAIChat(true);
        } else {
          setSelection(cleaned);
        }
      } catch (error) {
        setCapture(null);
        Alert.alert(
          t("web.ocrFailed", "Could not read that"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setOcrBusy(false);
      }
    },
    [capture, capturePurpose, domPageContext, t, transcribeCapture],
  );

  const copySelection = useCallback(() => {
    if (!selection) return;
    void Clipboard.setStringAsync(selection);
    setSelection(null);
  }, [selection]);

  const currentIsSaved = url ? isSavedUrl(saved, url) : false;

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.addressRow}>
        <TouchableOpacity
          style={s.navButton}
          disabled={!canGoBack}
          onPress={() => webRef.current?.goBack()}
          accessibilityLabel={t("web.back", "Back")}
        >
          <ChevronLeftIcon color={canGoBack ? colors.foreground : colors.border} size={22} />
        </TouchableOpacity>
        <TouchableOpacity
          style={s.navButton}
          disabled={!canGoForward}
          onPress={() => webRef.current?.goForward()}
          accessibilityLabel={t("web.forward", "Forward")}
        >
          <ChevronRightIcon color={canGoForward ? colors.foreground : colors.border} size={22} />
        </TouchableOpacity>

        <TextInput
          style={s.address}
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={() => open(address)}
          placeholder={t("web.addressPlaceholder", "Address or search")}
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          selectTextOnFocus
        />

        {url ? (
          <>
            <TouchableOpacity
              style={s.navButton}
              onPress={() => toggleSaved({ url, title: pageTitle || url })}
              accessibilityLabel={t("web.save", "Save page")}
            >
              {currentIsSaved ? (
                <BookmarkFilledIcon color={colors.primary} size={20} />
              ) : (
                <BookmarkIcon color={colors.foreground} size={20} />
              )}
            </TouchableOpacity>
            {isOcrAvailable ? (
              <TouchableOpacity
                style={s.navButton}
                onPress={() => void startRegionCapture("read")}
                accessibilityLabel={t("web.readRegion", "Read a region")}
              >
                <ScanTextIcon color={colors.foreground} size={20} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={s.navButton}
              onPress={() => webRef.current?.reload()}
              accessibilityLabel={t("web.reload", "Reload")}
            >
              <RefreshCwIcon color={colors.foreground} size={18} />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.navButton}
              onPress={closePage}
              accessibilityLabel={t("common.close", "Close")}
            >
              <XIcon color={colors.mutedForeground} size={20} />
            </TouchableOpacity>
          </>
        ) : null}
      </View>

      {/* Under the address row, never on top of it. */}
      {loading ? <View style={s.loadingBar} /> : null}

      {url ? (
        // collapsable={false} keeps a real view behind this on Android, which
        // captureRef needs — without it the node is optimised away.
        <View ref={pageRef} collapsable={false} style={s.web}>
          <WebView
            ref={webRef}
            source={{ uri: url }}
            style={s.web}
            injectedJavaScript={SELECTION_BRIDGE_JS}
            onMessage={(event) => handleMessage(event.nativeEvent.data)}
            onNavigationStateChange={handleNavigationStateChange}
            onLoadStart={() => {
              setLoading(true);
              setSelection(null);
              setFullPageContext("");
              backgroundTranscriptRef.current = null;
            }}
            onLoadEnd={() => {
              setLoading(false);
              captureWebPageContext();
            }}
            onError={({ nativeEvent }) => {
              setLoading(false);
              Alert.alert(
                t("web.loadFailed", "Could not load the page"),
                nativeEvent.description || String(nativeEvent.code),
              );
            }}
            allowsBackForwardNavigationGestures
            setSupportMultipleWindows={false}
            // Long-press select is the whole interaction, so it must survive the
            // WebView's own defaults on Android.
            textInteractionEnabled
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction
            userAgent={
              Platform.OS === "android"
                ? "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
                : undefined
            }
          />
        </View>
      ) : (
        <ScrollView
          style={s.home}
          contentContainerStyle={[s.homeContent, { paddingBottom: tabBarHeight + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.hero}>
            <ReadingSvg width={132} height={132} color={colors.mutedForeground} />
            <Text style={s.heroTitle}>{t("web.heroTitle", "What would you like to read?")}</Text>
            <Text style={s.heroSubtitle}>
              {t(
                "web.heroSubtitle",
                "A page opened here gets the dictionary, the voice and Sensei, exactly as a book does.",
              )}
            </Text>
          </View>

          <View style={s.grid}>
            {STARTER_SITES.map((site) => (
              <TouchableOpacity
                key={site.id}
                style={s.startCard}
                onPress={() => open(site.url)}
                activeOpacity={0.8}
              >
                {starterIcon(site.icon, colors.mutedForeground)}
                <Text style={s.startTitle}>{site.title}</Text>
                <Text style={s.startNote} numberOfLines={2}>
                  {site.note}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {saved.length > 0 ? (
            <View style={s.section}>
              <TouchableOpacity
                style={s.sectionHeader}
                onPress={toggleSavedCollapsed}
                activeOpacity={0.7}
              >
                <Text style={s.sectionTitle}>
                  {t("web.saved", "Saved")}
                  <Text style={s.sectionCount}>{`  ${saved.length}`}</Text>
                </Text>
                {savedCollapsed ? (
                  <ChevronDownIcon size={18} color={colors.mutedForeground} />
                ) : (
                  <ChevronUpIcon size={18} color={colors.mutedForeground} />
                )}
              </TouchableOpacity>
              {savedCollapsed ? null : (
                <View style={s.grid}>
                  {saved.map((page) => {
                    const tone = colorForUrl(page.url);
                    return (
                      <TouchableOpacity
                        key={page.url}
                        style={[s.tile, { backgroundColor: tone.tint, borderColor: tone.accent }]}
                        onPress={() => open(page.url)}
                        activeOpacity={0.8}
                      >
                        <View style={s.tileTop}>
                          <View style={[s.tileBadge, { backgroundColor: tone.accent }]}>
                            <Text style={s.tileBadgeText}>{initialOf(page.url, page.title)}</Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => removeSaved(page.url)}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            accessibilityLabel={t("web.unsave", "Remove saved page")}
                          >
                            <XIcon size={15} color={tone.accent} />
                          </TouchableOpacity>
                        </View>
                        <Text style={s.tileTitle} numberOfLines={2}>
                          {page.title || hostOf(page.url)}
                        </Text>
                        <Text style={[s.tileHost, { color: tone.accent }]} numberOfLines={1}>
                          {hostOf(page.url)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          {recent.length > 0 ? (
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>{t("web.recent", "Recent")}</Text>
                <TouchableOpacity onPress={clearRecent}>
                  <Text style={s.clear}>{t("web.clear", "Clear")}</Text>
                </TouchableOpacity>
              </View>
              {recent.map((page) => {
                const tone = colorForUrl(page.url);
                return (
                  <TouchableOpacity
                    key={page.url}
                    style={s.row}
                    onPress={() => open(page.url)}
                    activeOpacity={0.7}
                  >
                    <View style={[s.dot, { backgroundColor: tone.accent }]} />
                    <View style={s.rowText}>
                      <Text style={s.rowTitle} numberOfLines={1}>
                        {page.title || hostOf(page.url)}
                      </Text>
                      <Text style={s.rowNote} numberOfLines={1}>
                        {hostOf(page.url)} · {relativeTime(page.visitedAt)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      )}

      {url ? (
        <>
          {showAIMenu ? (
            <View
              style={[
                s.aiMenu,
                {
                  left: Math.max(8, Math.min(windowWidth - 184, bubbleCoordinates.x - 124)),
                  top: Math.max(8, bubbleCoordinates.y - 106),
                },
              ]}
            >
              <TouchableOpacity style={s.aiMenuItem} onPress={openWebChat}>
                <BotIcon size={19} color={colors.foreground} />
                <Text style={s.aiMenuText}>{t("chat.title", "Chat")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.aiMenuItem}
                onPress={() => {
                  setShowAIMenu(false);
                  void startRegionCapture("ai");
                }}
              >
                <ScanTextIcon size={19} color={colors.foreground} />
                <Text style={s.aiMenuText}>{t("web.selectText", "Select text")}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <Animated.View
            accessibilityRole="button"
            accessibilityLabel={t("reader.askAI", "Ask AI")}
            style={[s.aiBubble, { transform: bubblePosition.getTranslateTransform() }]}
            {...aiBubblePanResponder.panHandlers}
          >
            <BotIcon size={22} color="#fff" />
          </Animated.View>
        </>
      ) : null}

      <ReaderAIChatSheet
        visible={showAIChat}
        contextTitle={pageTitle || hostOf(address)}
        contextText={webPageContext}
        autoPrompt={pendingAIPrompt}
        onAutoPromptConsumed={() => setPendingAIPrompt(null)}
        onClose={() => setShowAIChat(false)}
        onOpenSettings={() => {
          setShowAIChat(false);
          navigation.navigate("Chat");
        }}
      />

      {selection ? (
        <WebSelectionBar
          text={selection}
          bottomOffset={tabBarHeight}
          isSpeaking={speaking}
          onDefine={() => setDefinition({ word: selection })}
          onSpeak={speakSelection}
          onAsk={askSensei}
          onCopy={copySelection}
          onDismiss={() => setSelection(null)}
        />
      ) : null}

      {capture ? (
        <RegionCaptureOverlay
          uri={capture.uri}
          imageWidth={capture.width}
          imageHeight={capture.height}
          busy={ocrBusy}
          onSelect={(region) => void handleRegion(region)}
          onSelectWholePage={
            capturePurpose === "ai"
              ? () => void handleRegion({ x: 0, y: 0, width: 1, height: 1 })
              : undefined
          }
          actionLabel={
            capturePurpose === "ai" ? t("web.aiAskSelection", "Ask about selection") : undefined
          }
          onCancel={() => setCapture(null)}
        />
      ) : null}

      <DefinitionSheet
        visible={definition !== null}
        word={definition?.word ?? ""}
        baseForms={[]}
        onClose={() => setDefinition(null)}
      />
    </SafeAreaView>
  );
}

function Section({
  title,
  colors,
  action,
  children,
}: {
  title: string;
  colors: ThemeColors;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const s = makeStyles(colors);
  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** The starter cards wear an outline icon, the way the AI page's cards do. */
function starterIcon(kind: string, color: string) {
  const size = 22;
  if (kind === "library") return <LibraryIcon size={size} color={color} />;
  if (kind === "news") return <ScrollTextIcon size={size} color={color} />;
  if (kind === "book") return <BookOpenIcon size={size} color={color} />;
  if (kind === "search") return <SearchIcon size={size} color={color} />;
  return <GlobeIcon size={size} color={color} />;
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    addressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    navButton: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    address: {
      flex: 1,
      height: 36,
      paddingHorizontal: spacing.md,
      borderRadius: radius.full,
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: fs.sm,
    },
    // A slim line under the address row. The old spinner sat at a fixed offset
    // that put it inside the address field.
    loadingBar: {
      height: 3,
      backgroundColor: colors.primary,
    },
    web: {
      flex: 1,
      backgroundColor: colors.background,
    },
    aiBubble: {
      position: "absolute",
      left: 0,
      top: 0,
      zIndex: 20,
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(59, 130, 246, 0.94)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255, 255, 255, 0.42)",
      elevation: 5,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
    },
    aiMenu: {
      position: "absolute",
      zIndex: 21,
      width: 176,
      padding: 6,
      gap: 2,
      borderRadius: radius.lg,
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      elevation: 7,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
    },
    aiMenuItem: {
      minHeight: 42,
      paddingHorizontal: spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radius.md,
    },
    aiMenuText: {
      color: colors.foreground,
      fontSize: fs.sm,
      fontWeight: fw.medium,
    },
    home: {
      flex: 1,
    },
    homeContent: {
      padding: spacing.lg,
      gap: spacing.xxl,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.md,
    },
    // Two to a row, so a saved page is a thing you can see rather than a line
    // of text among other lines.
    tile: {
      flexGrow: 1,
      flexBasis: "46%",
      minHeight: 104,
      borderRadius: radius.xl,
      borderWidth: 1,
      padding: spacing.md,
      justifyContent: "space-between",
    },
    tileTop: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
    },
    tileBadge: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
    },
    tileBadgeText: {
      color: "#fff",
      fontSize: fs.sm,
      fontWeight: fw.semibold,
    },
    tileTitle: {
      color: colors.foreground,
      fontSize: fs.sm,
      fontWeight: fw.medium,
      marginTop: spacing.sm,
    },
    tileHost: {
      fontSize: fs.xs,
      marginTop: 2,
    },
    // Mirrors the AI tab's empty state: a centred drawing, a question, a line
    // of explanation, then a grid of ways in.
    hero: {
      alignItems: "center",
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
      gap: spacing.sm,
    },
    heroTitle: {
      color: colors.foreground,
      fontSize: fs.xl,
      fontWeight: fw.bold,
      textAlign: "center",
      marginTop: spacing.sm,
    },
    heroSubtitle: {
      color: colors.mutedForeground,
      fontSize: fs.sm,
      textAlign: "center",
      lineHeight: ui(20),
      paddingHorizontal: spacing.md,
    },
    startCard: {
      flexGrow: 1,
      flexBasis: "46%",
      minHeight: 112,
      borderRadius: radius.xl,
      backgroundColor: colors.muted,
      padding: spacing.md,
      gap: spacing.xs,
    },
    startTitle: {
      color: colors.foreground,
      fontSize: fs.sm,
      fontWeight: fw.medium,
      marginTop: spacing.xs,
    },
    startNote: {
      color: colors.mutedForeground,
      fontSize: fs.xs,
      lineHeight: ui(16),
    },
    // The count keeps the section informative while it is folded away.
    sectionCount: {
      color: colors.mutedForeground,
      fontSize: fs.xs,
      fontWeight: fw.medium,
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    chip: {
      borderWidth: 1,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    chipText: {
      fontSize: fs.xs,
      fontWeight: fw.medium,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    homeLead: {
      color: colors.mutedForeground,
      fontSize: fs.sm,
      lineHeight: ui(20),
    },
    section: {
      gap: spacing.xs,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.xs,
    },
    sectionTitle: {
      color: colors.foreground,
      fontSize: fs.sm,
      fontWeight: fw.semibold,
    },
    clear: {
      color: colors.mutedForeground,
      fontSize: fs.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    rowMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      color: colors.foreground,
      fontSize: fs.sm,
    },
    rowNote: {
      color: colors.mutedForeground,
      fontSize: fs.xs,
      marginTop: 1,
    },
    rowAction: {
      padding: spacing.xs,
    },
  });
