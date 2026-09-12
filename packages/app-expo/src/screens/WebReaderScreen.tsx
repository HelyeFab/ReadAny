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
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";

import { DefinitionSheet } from "@/components/reader/DefinitionSheet";
import {
  BookmarkFilledIcon,
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { WebSelectionBar } from "@/components/web/WebSelectionBar";
import { previewTTSConfig, stopTTSPreview } from "@/lib/platform/tts-preview";
import { SELECTION_BRIDGE_JS, parseWebBridgeMessage } from "@/lib/web/selection-bridge";
import { STARTER_SITES, resolveInputToUrl } from "@/lib/web/starter-sites";
import type { TabParamList } from "@/navigation/TabNavigator";
import { isSavedUrl, useTTSStore, useWebStore } from "@/stores";
import { fontSize as fs, fontWeight as fw, radius, spacing, useColors } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";

export function WebReaderScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();

  const webRef = useRef<WebView>(null);
  const { lastUrl, recent, saved, _hasHydrated, recordVisit, toggleSaved, removeSaved, clearRecent } =
    useWebStore();
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

  // Reopen whatever was being read, but only once the persisted state has
  // actually arrived — reading `lastUrl` before that always looks like "empty".
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!_hasHydrated || restoredRef.current) return;
    restoredRef.current = true;
    if (lastUrl) {
      setUrl(lastUrl);
      setAddress(lastUrl);
    }
  }, [_hasHydrated, lastUrl]);

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
    const quoted = selection;
    setSelection(null);
    navigation.navigate("Chat", {
      selectedText: quoted,
      source: pageTitle || address,
    });
  }, [selection, navigation, pageTitle, address]);

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

      {loading ? <ActivityIndicator style={s.spinner} color={colors.primary} /> : null}

      {url ? (
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
          }}
          onLoadEnd={() => setLoading(false)}
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
      ) : (
        <ScrollView
          style={s.home}
          contentContainerStyle={[s.homeContent, { paddingBottom: tabBarHeight + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.homeLead}>
            {t(
              "web.lead",
              "Open a page and read it here. Selecting text gives you the dictionary, the voice, and Sensei, the same as in a book.",
            )}
          </Text>

          <Section title={t("web.startHere", "Start here")} colors={colors}>
            {STARTER_SITES.map((site) => (
              <TouchableOpacity key={site.id} style={s.row} onPress={() => open(site.url)}>
                <GlobeIcon color={colors.mutedForeground} size={18} />
                <View style={s.rowText}>
                  <Text style={s.rowTitle}>{site.title}</Text>
                  <Text style={s.rowNote}>{site.note}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </Section>

          {saved.length > 0 ? (
            <Section title={t("web.saved", "Saved")} colors={colors}>
              {saved.map((page) => (
                <View key={page.url} style={s.row}>
                  <TouchableOpacity style={s.rowMain} onPress={() => open(page.url)}>
                    <BookmarkFilledIcon color={colors.primary} size={18} />
                    <View style={s.rowText}>
                      <Text style={s.rowTitle} numberOfLines={1}>
                        {page.title || page.url}
                      </Text>
                      <Text style={s.rowNote} numberOfLines={1}>
                        {page.url}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => removeSaved(page.url)} style={s.rowAction}>
                    <Trash2Icon color={colors.mutedForeground} size={16} />
                  </TouchableOpacity>
                </View>
              ))}
            </Section>
          ) : null}

          {recent.length > 0 ? (
            <Section
              title={t("web.recent", "Recent")}
              colors={colors}
              action={
                <TouchableOpacity onPress={clearRecent}>
                  <Text style={s.clear}>{t("web.clear", "Clear")}</Text>
                </TouchableOpacity>
              }
            >
              {recent.map((page) => (
                <TouchableOpacity key={page.url} style={s.row} onPress={() => open(page.url)}>
                  <GlobeIcon color={colors.mutedForeground} size={18} />
                  <View style={s.rowText}>
                    <Text style={s.rowTitle} numberOfLines={1}>
                      {page.title || page.url}
                    </Text>
                    <Text style={s.rowNote} numberOfLines={1}>
                      {page.url}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </Section>
          ) : null}
        </ScrollView>
      )}

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
    spinner: {
      position: "absolute",
      top: 64,
      alignSelf: "center",
      zIndex: 2,
    },
    web: {
      flex: 1,
      backgroundColor: colors.background,
    },
    home: {
      flex: 1,
    },
    homeContent: {
      padding: spacing.lg,
      gap: spacing.xl,
    },
    homeLead: {
      color: colors.mutedForeground,
      fontSize: fs.sm,
      lineHeight: 20,
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
