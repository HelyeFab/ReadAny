import { renderRubyText } from "@/components/chat/RubyText";
import { MermaidView } from "@/components/common/MermaidView";
import { ListIcon, Volume2Icon } from "@/components/ui/Icon";
import { hasRubyParens } from "@/lib/ruby/parse-ruby-parens";
import { stripRubyReadings } from "@/lib/ruby/parse-ruby-parens";
import { fontSize as fs, radius, ui, useColors } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import type { CitationPart } from "@readany/core/types/message";
import * as Clipboard from "expo-clipboard";
import { Fragment, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import Markdown, { type RenderRules, type ASTNode } from "react-native-markdown-display";

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  styleOverrides?: Record<string, any>;
  citations?: CitationPart[];
  onCitationClick?: (citation: CitationPart) => void;
  onSpeakJapanese?: (text: string) => void;
  onDefineJapanese?: (text: string) => void;
}

function nodeText(node: ASTNode): string {
  if (typeof node.content === "string" && node.content.length > 0) return node.content;
  return (node.children ?? []).map(nodeText).join("");
}

function japaneseFocus(node: ASTNode): string | null {
  const text = nodeText(node).replace(/[*_`]/g, "").trim();
  const firstJapanese = text.search(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u);
  if (firstJapanese < 0) return null;
  // Controls belong to Japanese source lines. Do not decorate an English
  // explanation merely because it quotes a Japanese word later in the line.
  if (/[\p{L}\p{N}]/u.test(text.slice(0, firstJapanese))) return null;
  const beforeTranslation = text.slice(firstJapanese).split(/[:：]/u, 1)[0].trim();
  const plain = stripRubyReadings(beforeTranslation).trim();
  const japaneseCharacters = plain.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  );
  return (japaneseCharacters?.length ?? 0) >= 2 ? plain : null;
}

function sectionHeadingBackground(label: string, colors: ThemeColors): string | null {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[:：]$/, "");
  if (normalized === "japanese" || normalized === "source text") return colors.highlightPink;
  if (normalized === "translation") return colors.highlightBlue;
  if (normalized === "meaning and nuance" || normalized === "meaning & nuance") {
    return colors.highlightPurple;
  }
  if (normalized === "word breakdown") return colors.highlightGreen;
  return null;
}

function plainSectionLabel(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/u, "")
    .replace(/[*_`]/gu, "")
    .replace(/[:：]$/u, "")
    .trim()
    .toLowerCase();
}

/**
 * OCR keeps the visual line breaks from a manga crop. Those fragments become
 * hard Markdown breaks and leave a tablet-sized response looking like a thin
 * column. Reflow only the plain Japanese source lines; structured lists and
 * every explanatory section retain their authored layout.
 */
function reflowJapaneseSource(content: string): string {
  const lines = content.split("\n");
  const output: string[] = [];
  let inJapaneseSection = false;
  let sourceLines: string[] = [];

  const flushSource = () => {
    if (sourceLines.length === 0) return;
    output.push(sourceLines.join("　"));
    sourceLines = [];
  };

  for (const line of lines) {
    const label = plainSectionLabel(line);
    if (label === "japanese" || label === "source text") {
      flushSource();
      inJapaneseSection = true;
      output.push(line);
      continue;
    }
    if (
      inJapaneseSection &&
      ["translation", "meaning and nuance", "meaning & nuance", "word breakdown"].includes(label)
    ) {
      flushSource();
      inJapaneseSection = false;
      output.push(line);
      continue;
    }

    if (inJapaneseSection) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^(?:[-*+]\s|\d+[.)]\s|>|#{1,6}\s)/u.test(trimmed)) {
        flushSource();
        output.push(line);
      } else {
        sourceLines.push(trimmed);
      }
      continue;
    }

    output.push(line);
  }

  flushSource();
  return output.join("\n");
}

function JapaneseActions({
  text,
  accentColor,
  onSpeak,
  onDefine,
  stacked = false,
}: {
  text: string;
  accentColor: string;
  onSpeak?: (text: string) => void;
  onDefine?: (text: string) => void;
  stacked?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginLeft: stacked ? 0 : 10,
        marginTop: stacked ? 6 : 0,
        alignSelf: "flex-start",
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: radius.full,
        backgroundColor: `${accentColor}12`,
      }}
    >
      {onSpeak ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Speak ${text}`}
          onPress={() => onSpeak(text)}
          style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}
        >
          <Volume2Icon color={accentColor} size={16} />
        </TouchableOpacity>
      ) : null}
      {onDefine ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Break down ${text}`}
          onPress={() => onDefine(text)}
          style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}
        >
          <ListIcon color={accentColor} size={16} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function isUnsafeMarkdownTextColor(color: unknown): boolean {
  if (typeof color !== "string") return true;
  const normalized = color.replace(/\s+/g, "").toLowerCase();
  return (
    !normalized ||
    normalized === "black" ||
    normalized === "#000" ||
    normalized === "#000000" ||
    normalized === "rgb(0,0,0)" ||
    normalized === "rgba(0,0,0,1)"
  );
}

function getReadableTextColor(style: unknown, fallbackColor: string): string {
  const flattened = StyleSheet.flatten(style as StyleProp<TextStyle>) as
    | { color?: unknown }
    | undefined;
  return isUnsafeMarkdownTextColor(flattened?.color) ? fallbackColor : String(flattened?.color);
}

function CodeBlockWithCopy({
  code,
  style,
  colors,
}: { code: string; style: any; colors: ThemeColors }) {
  const { t } = useTranslation();
  return (
    <View style={style}>
      <TouchableOpacity
        onPress={() => Clipboard.setStringAsync(code)}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          padding: 4,
          backgroundColor: colors.card,
          borderRadius: 4,
          zIndex: 10,
        }}
      >
        <Text style={{ fontSize: ui(12), color: colors.mutedForeground }}>
          {t("common.copy", "复制")}
        </Text>
      </TouchableOpacity>
      <Text style={style}>{code}</Text>
    </View>
  );
}

function getCodeLanguage(node: ASTNode): string {
  if ((node as any).sourceInfo) {
    return String((node as any).sourceInfo)
      .toLowerCase()
      .trim();
  }

  if (node.attributes?.lang) {
    return String(node.attributes.lang).toLowerCase().trim();
  }

  if (node.attributes?.className) {
    const className = node.attributes.className;
    if (Array.isArray(className)) {
      const langClass = className.find((c: string) => c.startsWith("language-"));
      if (langClass) {
        return langClass.replace("language-", "").toLowerCase().trim();
      }
    } else if (typeof className === "string") {
      return className.replace("language-", "").toLowerCase().trim();
    }
  }

  return "";
}

function CitationLink({
  num,
  citation,
  onCitationClick,
  colors,
}: {
  num: number;
  citation: CitationPart;
  onCitationClick?: (citation: CitationPart) => void;
  colors: ThemeColors;
}) {
  return (
    <TouchableOpacity
      onPress={() => onCitationClick?.(citation)}
      activeOpacity={0.7}
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        marginHorizontal: 1,
      }}
    >
      <Text
        style={{
          color: colors.primary,
          fontSize: fs.xs,
          fontWeight: "600",
          lineHeight: fs.sm * 1.4,
        }}
      >
        [{num}]
      </Text>
      <Text
        style={{
          color: colors.primary,
          fontSize: ui(8),
          marginLeft: 1,
          lineHeight: fs.sm * 1.4,
        }}
      >
        ↗
      </Text>
    </TouchableOpacity>
  );
}

function renderTextWithCitations(
  text: string,
  citations: CitationPart[] | undefined,
  onCitationClick: ((citation: CitationPart) => void) | undefined,
  colors: ThemeColors,
): React.ReactNode[] {
  if (!citations || citations.length === 0) {
    return [<Fragment key="0">{text}</Fragment>];
  }

  const parts = text.split(/(\[\d+\])/g);
  const result: React.ReactNode[] = [];
  let offset = 0;

  for (const part of parts) {
    const keyOffset = offset;
    offset += part.length;
    const match = part.match(/\[(\d+)\]/);
    if (match) {
      const num = Number.parseInt(match[1]);
      const citation = citations.find((c) => c.citationIndex === num) ?? citations[num - 1];
      if (citation) {
        result.push(
          <CitationLink
            key={`citation-${keyOffset}-${num}`}
            num={num}
            citation={citation}
            onCitationClick={onCitationClick}
            colors={colors}
          />,
        );
        continue;
      }
    }
    if (part) {
      result.push(<Fragment key={`text-${keyOffset}`}>{part}</Fragment>);
    }
  }

  return result;
}

export function MarkdownRenderer({
  content,
  isStreaming,
  styleOverrides,
  citations,
  onCitationClick,
  onSpeakJapanese,
  onDefineJapanese,
}: MarkdownRendererProps) {
  const colors = useColors();
  const displayContent = useMemo(() => reflowJapaneseSource(content), [content]);
  const baseStyles = makeMarkdownStyles(colors);
  // When styleOverrides is provided, use it directly without merging with baseStyles
  // This ensures custom styles (like tooltip dark background) are not overridden
  const styles = styleOverrides || baseStyles;

  const rules = useMemo<RenderRules>(() => {
    const renderHeading =
      (level: 1 | 2 | 3) =>
      (node: ASTNode, children: ReactNode[], parentNodes: ASTNode[], style: any) => {
        const backgroundColor = sectionHeadingBackground(nodeText(node), colors);
        const headingStyle = style[`heading${level}`];
        if (!backgroundColor) {
          return (
            <Text key={node.key} style={headingStyle}>
              {children}
            </Text>
          );
        }
        return (
          <View
            key={node.key}
            style={{
              alignSelf: "flex-start",
              marginTop: 10,
              marginBottom: 7,
              paddingHorizontal: 12,
              paddingVertical: 5,
              borderRadius: radius.full,
              backgroundColor,
            }}
          >
            <Text style={[headingStyle, { marginTop: 0, marginBottom: 0 }]}>{children}</Text>
          </View>
        );
      };

    return {
      heading1: renderHeading(1),
      heading2: renderHeading(2),
      heading3: renderHeading(3),
      fence: (node: ASTNode, children: ReactNode[], parentNodes: ASTNode[], style: any) => {
        const code = node.content || "";
        const lang = getCodeLanguage(node);

        if (lang === "mermaid") {
          return <MermaidView key={node.key} chart={code} />;
        }

        return <CodeBlockWithCopy key={node.key} code={code} style={style.fence} colors={colors} />;
      },
      code_block: (node: ASTNode, children: ReactNode[], parentNodes: ASTNode[], style: any) => {
        const code = node.content || "";
        const lang = getCodeLanguage(node);

        if (lang === "mermaid") {
          return <MermaidView key={node.key} chart={code} />;
        }

        return (
          <CodeBlockWithCopy key={node.key} code={code} style={style.code_block} colors={colors} />
        );
      },
      text: (node: ASTNode, children: ReactNode[], parentNodes: ASTNode[], style: any) => {
        const text = node.content || "";
        const readableStyle = [style, { color: getReadableTextColor(style, colors.foreground) }];
        if (citations && citations.length > 0 && /\[\d+\]/.test(text)) {
          return (
            <Text key={node.key} style={readableStyle}>
              {renderTextWithCitations(text, citations, onCitationClick, colors)}
            </Text>
          );
        }
        // Sensei writes furigana as 漢字（かんじ）because the stream is plain
        // markdown. Draw it as stacked ruby rather than leaving the parentheses.
        if (hasRubyParens(text)) {
          return (
            <Text key={node.key} style={readableStyle}>
              {renderRubyText(text, readableStyle, node.key)}
            </Text>
          );
        }
        return (
          <Text key={node.key} style={readableStyle}>
            {text}
          </Text>
        );
      },
      paragraph: (node: ASTNode, children: ReactNode[], parentNodes: ASTNode[], style: any) => {
        const focus = japaneseFocus(node);
        const sectionBackground = sectionHeadingBackground(nodeText(node), colors);
        if (sectionBackground) {
          return (
            <View
              key={node.key}
              style={{
                alignSelf: "flex-start",
                marginTop: 10,
                marginBottom: 7,
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderRadius: radius.full,
                backgroundColor: sectionBackground,
              }}
            >
              <Text style={[style.paragraph, { marginTop: 0, marginBottom: 0 }]}>{children}</Text>
            </View>
          );
        }
        return (
          <View key={node.key} style={style._VIEW_SAFE_paragraph}>
            {children}
            {focus && (onSpeakJapanese || onDefineJapanese) ? (
              <JapaneseActions
                text={focus}
                accentColor={colors.primary}
                onSpeak={onSpeakJapanese}
                onDefine={onDefineJapanese}
              />
            ) : null}
          </View>
        );
      },
      list_item: (node: ASTNode, children: ReactNode[], parentNodes: ASTNode[], style: any) => {
        const focus = japaneseFocus(node);
        const orderedList = parentNodes.find((parent) => parent.type === "ordered_list");
        const marker = orderedList
          ? `${((orderedList.attributes?.start as number | undefined) ?? 1) + (node.index ?? 0)}${node.markup}`
          : "•";
        return (
          <View key={node.key} style={style._VIEW_SAFE_list_item}>
            <Text
              style={orderedList ? style.ordered_list_icon : style.bullet_list_icon}
              accessible={false}
            >
              {marker}
            </Text>
            <View
              style={[
                orderedList
                  ? style._VIEW_SAFE_ordered_list_content
                  : style._VIEW_SAFE_bullet_list_content,
                focus && (onSpeakJapanese || onDefineJapanese)
                  ? { flexDirection: "row", alignItems: "center", flexWrap: "wrap" }
                  : null,
              ]}
            >
              <View style={{ flexShrink: 1 }}>{children}</View>
              {focus && (onSpeakJapanese || onDefineJapanese) ? (
                <JapaneseActions
                  text={focus}
                  accentColor={colors.primary}
                  onSpeak={onSpeakJapanese}
                  onDefine={onDefineJapanese}
                />
              ) : null}
            </View>
          </View>
        );
      },
    };
  }, [colors, citations, onCitationClick, onDefineJapanese, onSpeakJapanese]);

  return (
    <View>
      <Markdown style={styles} rules={rules} mergeStyle>
        {displayContent}
      </Markdown>
    </View>
  );
}

const makeMarkdownStyles = (colors: ThemeColors) =>
  ({
    body: {
      color: colors.foreground,
      fontSize: fs.sm,
      // Leaves room in the leading for the stacked readings RubyText draws, so
      // a line carrying furigana is no taller than a plain one.
      lineHeight: ui(28),
    },
    text: {
      color: colors.foreground,
    },
    textgroup: {
      color: colors.foreground,
    },
    heading1: {
      color: colors.foreground,
      fontSize: fs.lg,
      fontWeight: "700",
      marginBottom: 8,
      marginTop: 12,
    },
    heading2: {
      color: colors.foreground,
      fontSize: fs.md,
      fontWeight: "600",
      marginBottom: 6,
      marginTop: 10,
    },
    heading3: {
      color: colors.foreground,
      fontSize: fs.base,
      fontWeight: "600",
      marginBottom: 4,
      marginTop: 8,
    },
    paragraph: {
      color: colors.foreground,
      fontSize: fs.sm,
      lineHeight: ui(28),
      marginBottom: 8,
      marginTop: 0,
    },
    strong: { color: colors.foreground, fontWeight: "700" },
    em: { color: colors.foreground, fontStyle: "italic" },
    s: { color: colors.foreground },
    link: { color: colors.blue, textDecorationLine: "none" },
    blockquote: {
      color: colors.mutedForeground,
      borderLeftWidth: 3,
      borderLeftColor: colors.border,
      paddingLeft: 12,
      marginLeft: 0,
      marginVertical: 6,
      backgroundColor: "transparent",
    },
    code_inline: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: fs.xs + 1,
      fontFamily: "Menlo",
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: radius.sm,
    },
    code_block: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: fs.xs + 1,
      fontFamily: "Menlo",
      padding: 12,
      borderRadius: radius.md,
      marginVertical: 6,
    },
    fence: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: fs.xs + 1,
      fontFamily: "Menlo",
      padding: 12,
      borderRadius: radius.md,
      marginVertical: 6,
    },
    table: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      marginVertical: 6,
    },
    thead: {
      backgroundColor: colors.muted,
    },
    th: {
      color: colors.foreground,
      fontSize: fs.xs,
      fontWeight: "600",
      padding: 6,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    td: {
      color: colors.foreground,
      fontSize: fs.xs,
      padding: 6,
      borderBottomWidth: 0.5,
      borderColor: colors.border,
    },
    bullet_list: { color: colors.foreground, marginVertical: 4 },
    ordered_list: { color: colors.foreground, marginVertical: 4 },
    list_item: {
      color: colors.foreground,
      marginBottom: 4,
      flexDirection: "row",
    },
    bullet_list_icon: { color: colors.foreground },
    bullet_list_content: { color: colors.foreground },
    ordered_list_icon: { color: colors.foreground },
    ordered_list_content: { color: colors.foreground },
    hr: {
      backgroundColor: colors.border,
      height: 1,
      marginVertical: 12,
    },
    image: {
      maxWidth: 300,
      borderRadius: radius.md,
    },
  }) as const;
