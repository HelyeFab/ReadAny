import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { MessageCirclePlusIcon, XIcon } from "@/components/ui/Icon";
import { resolveActiveAIConfig } from "@/lib/ai/resolve-active-ai-config";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { radius, useColors, withOpacity } from "@/styles/theme";
import { useStreamingChat } from "@readany/core/hooks/use-streaming-chat";
import { useReadingContext } from "@readany/core/ai/reading-context-service";
import type { AttachedQuote, Book } from "@readany/core/types";
import type { CitationPart, MessageV2 } from "@readany/core/types/message";
import { convertToMessageV2, mergeMessagesWithStreaming } from "@readany/core/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
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
}: ReaderAIChatSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const readingContext = useReadingContext();

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
  const [threadsReady, setThreadsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!visible) {
      setThreadsReady(false);
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
  const transientMessage = activeThread?.id === currentMessage?.threadId ? currentMessage : null;
  const messages = useMemo(
    () =>
      mergeMessagesWithStreaming(persistedMessages, transientMessage, isStreaming).filter(
        (message) => {
          if (message.parts.length === 0) return false;
          if (message.role !== "user") return true;
          const visibleText = message.parts
            .filter((part) => part.type === "text")
            .map((part) => (part as { text: string }).text)
            .join("\n")
            .trim();
          return visibleText !== "Help me understand this selected manga text. Translate it and explain its meaning and nuance.";
        },
      ),
    [isStreaming, persistedMessages, transientMessage],
  );

  const handleSend = useCallback(
    async (
      text: string,
      deepThinking: boolean,
      spoilerFree: boolean,
      quotes?: AttachedQuote[],
      hideUserMessage = false,
    ) => {
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
    await createThread(bookId);
  }, [activeThread, bookId, createThread]);

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
        <Pressable style={s.backdrop} onPress={Keyboard.dismiss} />
        <View
          style={[
            s.sheet,
            messages.length === 0 && !isStreaming && s.sheetCompact,
            { paddingBottom: Math.max(insets.bottom, 8) },
          ]}
        >
          <View style={s.handle} />
          <View style={s.header}>
            <View style={s.titleBlock}>
              <Text style={s.title}>{t("chat.aiAssistant", "AI Reading Assistant")}</Text>
              <Text style={s.contextLabel} numberOfLines={1}>
                {contextTitle || semanticContext?.currentChapter || book?.meta.title || ""}
              </Text>
            </View>
            <TouchableOpacity style={s.headerButton} onPress={handleNewThread}>
              <MessageCirclePlusIcon size={19} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity style={s.headerButton} onPress={onClose}>
              <XIcon size={20} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={s.messages}>
            {messages.length > 0 ? (
              <MessageList
                messages={messages}
                isStreaming={isStreaming}
                currentStep={currentStep}
                onCitationClick={onCitation}
              />
            ) : (
              <View style={s.emptyState}>
                <Text style={s.emptyTitle}>{t("chat.askAboutBook", "Ask about this page")}</Text>
                <Text style={s.emptyText}>
                  {t(
                    "chat.currentPageReady",
                    "The current page and reading position are already available as context.",
                  )}
                </Text>
              </View>
            )}
          </View>

          <ChatInput
            onSend={handleSend}
            onStop={stopStream}
            isStreaming={isStreaming}
            placeholder={t("chat.askAboutCurrentPage", "Ask about the current page...")}
            keyboardBottomOffset={insets.bottom}
          />
        </View>
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
    sheetCompact: {
      height: "40%",
      minHeight: 350,
    },
    handle: {
      alignSelf: "center",
      width: 42,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: withOpacity(colors.foreground, 0.24),
      marginTop: 8,
      marginBottom: 4,
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
    messages: { flex: 1 },
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 36,
      paddingVertical: 12,
    },
    emptyTitle: { color: colors.foreground, fontSize: 18, fontWeight: "600" },
    emptyText: {
      color: colors.mutedForeground,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
      marginTop: 8,
    },
  });
