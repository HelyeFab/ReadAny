import { ChatInput } from "@/components/chat/ChatInput";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { MessageList } from "@/components/chat/MessageList";
import {
  HistoryIcon,
  MessageCirclePlusIcon,
  Trash2Icon,
  Volume2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { resolveActiveAIConfig } from "@/lib/ai/resolve-active-ai-config";
import { previewTTSConfig, stopTTSPreview } from "@/lib/platform/tts-preview";
import { useTTSStore } from "@/stores";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { radius, useColors, withOpacity } from "@/styles/theme";
import { useReadingContext } from "@readany/core/ai/reading-context-service";
import { useStreamingChat } from "@readany/core/hooks/use-streaming-chat";
import { type TTSConfig, syncConfigFromActiveProfile } from "@readany/core/tts";
import type { AttachedQuote, Book } from "@readany/core/types";
import type { CitationPart, MessageV2 } from "@readany/core/types/message";
import { convertToMessageV2, mergeMessagesWithStreaming } from "@readany/core/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ReaderAIChatSheetProps {
  visible: boolean;
  bookId?: string;
  book?: Book | null;
  contextTitle?: string;
  contextText?: string | null;
  autoPrompt?: { id: string; text: string } | null;
  onAutoPromptConsumed?: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onCitation?: (citation: CitationPart) => void;
  collapsedBottomOffset?: number;
}

export function ReaderAIChatSheet({
  visible,
  bookId,
  book,
  contextTitle,
  contextText,
  autoPrompt,
  onAutoPromptConsumed,
  onClose,
  onOpenSettings,
  onCitation,
  collapsedBottomOffset = 0,
}: ReaderAIChatSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const readingContext = useReadingContext();
  const ttsConfig = useTTSStore((state) => state.config);

  const speakJapaneseSegment = useCallback(
    (text: string) => {
      const alvisProfile = ttsConfig.profiles.find((profile) =>
        [profile.id, profile.name, profile.model, profile.voice].some((value) =>
          /alvis/i.test(value ?? ""),
        ),
      );
      let japaneseConfig: TTSConfig = alvisProfile
        ? syncConfigFromActiveProfile({ ...ttsConfig, activeProfileId: alvisProfile.id })
        : syncConfigFromActiveProfile(ttsConfig);

      if (japaneseConfig.engine === "edge") {
        japaneseConfig = { ...japaneseConfig, edgeVoice: "ja-JP-NanamiNeural" };
      } else if (japaneseConfig.engine === "system") {
        japaneseConfig = { ...japaneseConfig, voiceName: "", systemVoiceLabel: "" };
      } else if (japaneseConfig.engine === "openai-compatible") {
        japaneseConfig = {
          ...japaneseConfig,
          openaiTtsStylePrompt:
            "Read this Japanese text as a native Japanese speaker with natural pitch accent. Do not translate it.",
        };
      }

      stopTTSPreview();
      void previewTTSConfig(text, japaneseConfig, {
        onError: (error) => {
          Alert.alert(
            t("tts.previewFailed", "Speech failed"),
            error instanceof Error ? error.message : String(error),
          );
        },
      }).catch((error) => {
        Alert.alert(
          t("tts.previewFailed", "Speech failed"),
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [t, ttsConfig],
  );

  const semanticContext = useMemo(() => {
    if (!bookId || !readingContext || readingContext.bookId !== bookId) return null;
    return {
      currentChapter: readingContext.currentChapter.title,
      currentPosition: readingContext.currentPosition.cfi,
      surroundingText: readingContext.surroundingText,
      recentHighlights: readingContext.recentHighlights.map((highlight) => highlight.text),
      operationType:
        readingContext.operationType === "selecting"
          ? ("highlighting" as const)
          : readingContext.operationType,
    };
  }, [bookId, readingContext]);

  const threads = useChatStore((state) => state.threads);
  const loadThreads = useChatStore((state) => state.loadThreads);
  const getActiveThreadId = useChatStore((state) => state.getActiveThreadId);
  const getThreadsForContext = useChatStore((state) => state.getThreadsForContext);
  const setBookActiveThread = useChatStore((state) => state.setBookActiveThread);
  const createThread = useChatStore((state) => state.createThread);
  const removeThread = useChatStore((state) => state.removeThread);
  const [threadsReady, setThreadsReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const collapsedPosition = useRef(new Animated.ValueXY()).current;
  const collapsedCoordinates = useRef({ x: 0, y: 0 });
  const collapsedDragStart = useRef({ x: 0, y: 0 });
  const hasMovedCollapsedHandle = useRef(false);

  const clampCollapsedPosition = useCallback(
    (x: number, y: number) => ({
      x: Math.max(8, Math.min(windowWidth - 60, x)),
      y: Math.max(insets.top + 8, Math.min(windowHeight - collapsedBottomOffset - 38, y)),
    }),
    [collapsedBottomOffset, insets.top, windowHeight, windowWidth],
  );

  useEffect(() => {
    if (!collapsed) return;
    const next = hasMovedCollapsedHandle.current
      ? clampCollapsedPosition(collapsedCoordinates.current.x, collapsedCoordinates.current.y)
      : clampCollapsedPosition((windowWidth - 52) / 2, windowHeight - collapsedBottomOffset - 36);
    collapsedCoordinates.current = next;
    collapsedPosition.setValue(next);
  }, [
    clampCollapsedPosition,
    collapsed,
    collapsedBottomOffset,
    collapsedPosition,
    windowHeight,
    windowWidth,
  ]);

  const collapsedPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => collapsed,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          collapsed && Math.hypot(gesture.dx, gesture.dy) > 2,
        onPanResponderGrant: () => {
          collapsedDragStart.current = collapsedCoordinates.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const next = clampCollapsedPosition(
            collapsedDragStart.current.x + gesture.dx,
            collapsedDragStart.current.y + gesture.dy,
          );
          collapsedCoordinates.current = next;
          collapsedPosition.setValue(next);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (Math.hypot(gesture.dx, gesture.dy) <= 6) {
            setCollapsed(false);
            return;
          }
          hasMovedCollapsedHandle.current = true;
        },
        onPanResponderTerminate: () => {
          hasMovedCollapsedHandle.current = true;
        },
      }),
    [clampCollapsedPosition, collapsed, collapsedPosition],
  );

  useEffect(() => {
    let cancelled = false;
    if (!visible) {
      setThreadsReady(false);
      setCollapsed(false);
      return () => {
        cancelled = true;
      };
    }

    setThreadsReady(false);
    void loadThreads(bookId).finally(() => {
      if (!cancelled) setThreadsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, loadThreads, visible]);

  const activeThreadId = getActiveThreadId(bookId);
  const bookThreads = getThreadsForContext(bookId);
  const activeThread = activeThreadId
    ? (threads.find((thread) => thread.id === activeThreadId) ?? null)
    : null;

  useEffect(() => {
    if (visible && !activeThreadId && bookThreads[0]) {
      if (bookId) setBookActiveThread(bookId, bookThreads[0].id);
      else useChatStore.getState().setGeneralActiveThread(bookThreads[0].id);
    }
  }, [activeThreadId, bookId, bookThreads, setBookActiveThread, visible]);

  const { isStreaming, currentMessage, currentStep, sendMessage, stopStream } = useStreamingChat({
    book,
    bookId,
    semanticContext,
    silentContext: contextText,
  });
  const persistedMessages: MessageV2[] = useMemo(
    () => convertToMessageV2(activeThread?.messages ?? []),
    [activeThread],
  );
  const [wordCard, setWordCard] = useState<{
    term: string;
    content: string | null;
    requestedAt: number | null;
  } | null>(null);
  const breakdownAssistantIds = useMemo(() => {
    const ids = new Set<string>();
    const rawMessages = activeThread?.messages ?? [];
    for (let index = 0; index < rawMessages.length; index += 1) {
      const message = rawMessages[index];
      if (
        message.role !== "user" ||
        !message.content.includes("Give a concise word breakdown for this Japanese expression:")
      ) {
        continue;
      }
      const response = rawMessages
        .slice(index + 1)
        .find((candidate) => candidate.role === "assistant");
      if (response) ids.add(response.id);
    }
    return ids;
  }, [activeThread?.messages]);
  const transientMessage = activeThread?.id === currentMessage?.threadId ? currentMessage : null;
  const messages = useMemo(
    () =>
      mergeMessagesWithStreaming(persistedMessages, transientMessage, isStreaming).filter(
        (message) => {
          if (message.parts.length === 0 || breakdownAssistantIds.has(message.id)) return false;
          if (
            wordCard?.requestedAt &&
            message.role === "assistant" &&
            message.id === transientMessage?.id
          ) {
            return false;
          }
          if (message.role !== "user") return true;
          const visibleText = message.parts
            .filter((part) => part.type === "text")
            .map((part) => (part as { text: string }).text)
            .join("\n")
            .trim();
          if (
            visibleText.startsWith("Give a concise word breakdown for this Japanese expression:")
          ) {
            return false;
          }
          return ![
            "Help me understand this selected manga text. Translate it and explain its meaning and nuance.",
            "Explain the selected manga text using the complete page for context. Translate it and explain its meaning and nuance.",
            "Explain the selected manga text using the complete page for context. Translate it, explain its meaning and nuance, then include a Word breakdown with each Japanese word, its reading, and its individual meaning.",
          ].includes(visibleText);
        },
      ),
    [breakdownAssistantIds, isStreaming, persistedMessages, transientMessage, wordCard],
  );
  const latestExchange = useMemo(() => {
    const rawMessages = activeThread?.messages ?? [];
    let startIndex = -1;
    for (let index = rawMessages.length - 1; index >= 0; index -= 1) {
      const message = rawMessages[index];
      if (
        message.role === "user" &&
        !message.content.includes("Give a concise word breakdown for this Japanese expression:")
      ) {
        startIndex = index;
        break;
      }
    }

    if (startIndex < 0) {
      return {
        key: activeThread?.id ?? "empty",
        ids: new Set(messages.map((message) => message.id)),
      };
    }

    return {
      key: rawMessages[startIndex].id,
      ids: new Set(rawMessages.slice(startIndex).map((message) => message.id)),
    };
  }, [activeThread?.id, activeThread?.messages, messages]);
  const latestMessages = useMemo(
    () =>
      messages.filter(
        (message) => latestExchange.ids.has(message.id) || message.id === transientMessage?.id,
      ),
    [latestExchange.ids, messages, transientMessage?.id],
  );
  const hasHistory = latestMessages.length < messages.length;
  const displayedMessages = showHistory ? messages : latestMessages;

  useEffect(() => {
    if (!wordCard || wordCard.content || !wordCard.requestedAt) return;
    const promptPrefix = `Give a concise word breakdown for this Japanese expression: ${wordCard.term}`;
    const rawMessages = activeThread?.messages ?? [];
    for (let index = rawMessages.length - 1; index >= 0; index -= 1) {
      const message = rawMessages[index];
      if (
        message.role !== "user" ||
        message.createdAt < wordCard.requestedAt ||
        !message.content.includes(promptPrefix)
      ) {
        continue;
      }
      const response = rawMessages
        .slice(index + 1)
        .find((candidate) => candidate.role === "assistant");
      if (response?.content.trim()) {
        setWordCard((current) =>
          current?.term === wordCard.term
            ? { ...current, content: response.content.trim() }
            : current,
        );
      }
      break;
    }
  }, [activeThread?.messages, wordCard]);

  const handleSend = useCallback(
    async (
      text: string,
      deepThinking: boolean,
      spoilerFree: boolean,
      quotes?: AttachedQuote[],
      hideUserMessage = false,
    ) => {
      setShowHistory(false);
      const resolvedAIConfig = await resolveActiveAIConfig(useSettingsStore.getState());
      if (!resolvedAIConfig) {
        Alert.alert(
          t("chat.configRequired", "AI configuration required"),
          t("chat.configRequiredMessage", "Configure an AI endpoint and model first."),
          [
            { text: t("common.cancel", "Cancel"), style: "cancel" },
            { text: t("common.settings", "Settings"), onPress: onOpenSettings },
          ],
        );
        return;
      }
      await sendMessage(
        text,
        bookId,
        deepThinking,
        spoilerFree,
        quotes,
        resolvedAIConfig,
        hideUserMessage,
      );
    },
    [bookId, onOpenSettings, sendMessage, t],
  );

  useEffect(() => {
    if (!wordCard || wordCard.content || wordCard.requestedAt || isStreaming) return;
    const requestedAt = Date.now();
    const term = wordCard.term;
    setWordCard((current) => (current?.term === term ? { ...current, requestedAt } : current));
    void handleSend(
      `Give a concise word breakdown for this Japanese expression: ${term}\nReturn only one compact entry with its reading, base form, part of speech, and meaning in this page's context. Do not repeat the expression or add further lists.`,
      false,
      true,
      undefined,
      true,
    );
  }, [handleSend, isStreaming, wordCard]);

  const consumedPromptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visible || !threadsReady || !autoPrompt || !contextText?.trim()) return;
    if (consumedPromptRef.current === autoPrompt.id) return;
    consumedPromptRef.current = autoPrompt.id;
    console.log(
      "[ReaderAIChat] auto-prompt-start",
      JSON.stringify({ id: autoPrompt.id, contextLength: contextText.trim().length }),
    );
    void handleSend(autoPrompt.text, false, true, undefined, true)
      .then(() => {
        console.log("[ReaderAIChat] auto-prompt-finished", JSON.stringify({ id: autoPrompt.id }));
        onAutoPromptConsumed?.();
      })
      .catch((error) => {
        consumedPromptRef.current = null;
        console.error("[ReaderAIChat] auto-prompt-error", error);
      });
  }, [autoPrompt, contextText, handleSend, onAutoPromptConsumed, threadsReady, visible]);

  const handleNewThread = useCallback(async () => {
    if (activeThread && activeThread.messages.length === 0) return;
    setShowHistory(false);
    await createThread(bookId);
  }, [activeThread, bookId, createThread]);

  const handleDefineJapanese = useCallback((text: string) => {
    setWordCard({ term: text, content: null, requestedAt: null });
  }, []);

  const handleClearChat = useCallback(() => {
    if (!activeThread || activeThread.messages.length === 0) return;
    Alert.alert(
      t("chat.clearChat", "Clear chat"),
      t("chat.clearChatConfirm", "Delete all messages in this conversation?"),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("common.clear", "Clear"),
          style: "destructive",
          onPress: () => {
            stopStream();
            void removeThread(activeThread.id).then(() => createThread(bookId));
          },
        },
      ],
    );
  }, [activeThread, bookId, createThread, removeThread, stopStream, t]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {!collapsed && <Pressable style={s.backdrop} onPress={Keyboard.dismiss} />}
        <Animated.View
          style={[
            s.sheet,
            !collapsed && messages.length === 0 && !isStreaming && !autoPrompt && s.sheetCompact,
            collapsed
              ? [s.sheetCollapsed, { left: 0, top: 0 }, collapsedPosition.getLayout()]
              : { paddingBottom: Math.max(insets.bottom, 8) },
          ]}
          {...(collapsed ? collapsedPanResponder.panHandlers : {})}
        >
          <TouchableOpacity
            style={[s.handleButton, collapsed && s.handleButtonCollapsed]}
            onPress={() => {
              Keyboard.dismiss();
              if (!collapsed) setCollapsed(true);
            }}
            activeOpacity={0.65}
            accessibilityRole="button"
            accessibilityLabel={
              collapsed
                ? t("chat.expandAssistant", "Show reading assistant")
                : t("chat.collapseAssistant", "Hide reading assistant")
            }
          >
            <View style={[s.handle, collapsed && s.handleCollapsed]} />
          </TouchableOpacity>
          {!collapsed && (
            <View style={s.header}>
              <View style={s.titleBlock}>
                <Text style={s.title}>{t("chat.aiAssistant", "AI Reading Assistant")}</Text>
                <Text style={s.contextLabel} numberOfLines={1}>
                  {contextTitle || semanticContext?.currentChapter || book?.meta.title || ""}
                </Text>
              </View>
              {hasHistory ? (
                <TouchableOpacity
                  style={[s.headerButton, showHistory && s.headerButtonActive]}
                  onPress={() => setShowHistory((current) => !current)}
                  accessibilityLabel={
                    showHistory
                      ? t("chat.showLatest", "Show latest result")
                      : t("chat.showHistory", "Show chat history")
                  }
                >
                  <HistoryIcon size={19} color={showHistory ? colors.primary : colors.foreground} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={s.headerButton} onPress={handleNewThread}>
                <MessageCirclePlusIcon size={19} color={colors.foreground} />
              </TouchableOpacity>
              <TouchableOpacity
                style={s.headerButton}
                onPress={handleClearChat}
                disabled={!activeThread || activeThread.messages.length === 0}
                accessibilityLabel={t("chat.clearChat", "Clear chat")}
              >
                <Trash2Icon
                  size={18}
                  color={
                    activeThread && activeThread.messages.length > 0
                      ? colors.foreground
                      : colors.border
                  }
                />
              </TouchableOpacity>
              <TouchableOpacity style={s.headerButton} onPress={onClose}>
                <XIcon size={20} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          )}

          {!collapsed && (
            <View style={s.messages}>
              {displayedMessages.length > 0 ? (
                <>
                  {hasHistory ? (
                    <TouchableOpacity
                      style={s.historyBar}
                      onPress={() => setShowHistory((current) => !current)}
                      activeOpacity={0.7}
                    >
                      <HistoryIcon size={15} color={colors.primary} />
                      <Text style={s.historyBarText}>
                        {showHistory
                          ? t("chat.backToLatest", "Back to latest result")
                          : t("chat.previousResults", "History")}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  <MessageList
                    messages={displayedMessages}
                    isStreaming={isStreaming}
                    currentStep={currentStep}
                    onCitationClick={onCitation}
                    onSpeakJapanese={speakJapaneseSegment}
                    onDefineJapanese={handleDefineJapanese}
                  />
                </>
              ) : (
                <View style={s.emptyState}>
                  {autoPrompt ? (
                    <>
                      <ActivityIndicator size="large" color={colors.primary} />
                      <Text style={s.emptyLoadingText}>
                        {t("web.ocrReading", "Reading the text…")}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={s.emptyTitle}>
                        {t("chat.askAboutBook", "Ask about this page")}
                      </Text>
                      <Text style={s.emptyText}>
                        {t(
                          "chat.currentPageReady",
                          "The current page and reading position are already available as context.",
                        )}
                      </Text>
                    </>
                  )}
                </View>
              )}
            </View>
          )}

          {!collapsed && (
            <ChatInput
              onSend={handleSend}
              onStop={stopStream}
              isStreaming={isStreaming}
              placeholder={t("chat.askAboutCurrentPage", "Ask about the current page...")}
              keyboardBottomOffset={insets.bottom}
            />
          )}

          {!collapsed && wordCard ? (
            <View style={s.wordCardBackdrop}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setWordCard(null)} />
              <View style={s.wordCard}>
                <View style={s.wordCardHeader}>
                  <View style={s.wordCardTitleBlock}>
                    <Text style={s.wordCardTerm}>{wordCard.term}</Text>
                    <Text style={s.wordCardLabel}>{t("chat.wordBreakdown", "Word breakdown")}</Text>
                  </View>
                  <TouchableOpacity
                    style={s.wordCardButton}
                    onPress={() => speakJapaneseSegment(wordCard.term)}
                    accessibilityLabel={t("tts.speak", "Speak")}
                  >
                    <Volume2Icon size={18} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.wordCardButton} onPress={() => setWordCard(null)}>
                    <XIcon size={19} color={colors.foreground} />
                  </TouchableOpacity>
                </View>
                {wordCard.content ? (
                  <ScrollView style={s.wordCardBody} showsVerticalScrollIndicator={false}>
                    <MarkdownRenderer content={wordCard.content} />
                  </ScrollView>
                ) : (
                  <View style={s.wordCardLoading}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={s.wordCardLoadingText}>
                      {t("chat.analyzingWord", "Analyzing word…")}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    overlay: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.22)",
    },
    sheet: {
      height: "72%",
      minHeight: 420,
      backgroundColor: colors.background,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: 0,
      borderColor: withOpacity(colors.foreground, 0.15),
      overflow: "hidden",
    },
    wordCardBackdrop: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 20,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
      backgroundColor: withOpacity(colors.background, 0.5),
    },
    wordCard: {
      width: "100%",
      maxWidth: 440,
      maxHeight: "58%",
      padding: 16,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.foreground, 0.18),
      backgroundColor: colors.card,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    wordCardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    wordCardTitleBlock: { flex: 1 },
    wordCardTerm: { color: colors.foreground, fontSize: 21, fontWeight: "700" },
    wordCardLabel: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
    wordCardButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
      backgroundColor: withOpacity(colors.primary, 0.08),
    },
    wordCardBody: { marginTop: 14 },
    wordCardLoading: {
      minHeight: 92,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
    },
    wordCardLoadingText: { color: colors.mutedForeground, fontSize: 14 },
    sheetCompact: {
      height: "40%",
      minHeight: 350,
    },
    sheetCollapsed: {
      position: "absolute",
      height: 30,
      minHeight: 0,
      width: 52,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRadius: 15,
      backgroundColor: colors.card,
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 2 },
      elevation: 5,
    },
    handleButton: {
      height: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    handleButtonCollapsed: {
      flex: 1,
      height: undefined,
      paddingHorizontal: 10,
    },
    handle: {
      width: 42,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: withOpacity(colors.foreground, 0.24),
    },
    handleCollapsed: {
      width: 24,
      backgroundColor: withOpacity(colors.foreground, 0.38),
    },
    header: {
      minHeight: 54,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withOpacity(colors.foreground, 0.12),
    },
    titleBlock: { flex: 1, paddingHorizontal: 4 },
    title: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
    contextLabel: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
    headerButton: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
    },
    headerButtonActive: { backgroundColor: withOpacity(colors.primary, 0.1) },
    historyBar: {
      minHeight: 36,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withOpacity(colors.foreground, 0.1),
      backgroundColor: withOpacity(colors.primary, 0.06),
    },
    historyBarText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
    messages: { flex: 1 },
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 36,
      paddingVertical: 12,
    },
    emptyTitle: { color: colors.foreground, fontSize: 18, fontWeight: "600" },
    emptyLoadingText: { color: colors.mutedForeground, fontSize: 14, marginTop: 12 },
    emptyText: {
      color: colors.mutedForeground,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
      marginTop: 8,
    },
  });
