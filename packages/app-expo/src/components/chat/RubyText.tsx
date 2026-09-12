/**
 * RubyText — draws 漢字（かんじ） glosses as stacked furigana.
 *
 * Sensei sends readings in parentheses because the chat stream is markdown with
 * no HTML in it. Left alone that reads as 拾（ひろ）い mid-sentence, which is
 * how a dictionary prints it, not how a reader wants it. Here each gloss
 * becomes a two-line column: reading on top, word on the baseline.
 *
 * The columns are inline views inside the surrounding Text, so a line that
 * carries furigana grows taller than one that does not — the same thing a
 * browser does with real <ruby>.
 */
import { StyleSheet, Text, View } from "react-native";
import { Fragment, type ReactNode } from "react";
import type { StyleProp, TextStyle } from "react-native";

import { parseRubyParens } from "@/lib/ruby/parse-ruby-parens";

const READING_SCALE = 0.52;

export function renderRubyText(
  text: string,
  style: StyleProp<TextStyle>,
  keyPrefix: string,
): ReactNode[] {
  const flattened = (StyleSheet.flatten(style) || {}) as TextStyle;
  const baseSize = typeof flattened.fontSize === "number" ? flattened.fontSize : 14;
  const readingSize = Math.max(8, Math.round(baseSize * READING_SCALE));

  return parseRubyParens(text).map((segment, index) => {
    const key = `${keyPrefix}-${index}`;
    if (segment.kind === "text") {
      return <Text key={key}>{segment.text}</Text>;
    }

    // Okurigana stays on the baseline beside the column, not under the ruby.
    return (
      <Fragment key={key}>
        {segment.prefix ? <Text>{segment.prefix}</Text> : null}
        <View
          style={[
            styles.column,
            // Android grows a line to fit an inline view, so a bare column would
            // leave ruby lines visibly taller than plain ones. Pull the reading
            // up into the paragraph's leading instead, the way a browser does.
            { marginTop: -(readingSize + 1) },
          ]}
        >
          <Text
            style={[
              style,
              {
                fontSize: readingSize,
                lineHeight: readingSize + 1,
                // The reading is a label, never bold, whatever the run around it does.
                fontWeight: "400",
              },
            ]}
          >
            {segment.reading}
          </Text>
          <Text style={[style, { lineHeight: baseSize * 1.15 }]}>{segment.base}</Text>
        </View>
        {segment.suffix ? <Text>{segment.suffix}</Text> : null}
      </Fragment>
    );
  });
}

const styles = StyleSheet.create({
  column: {
    flexDirection: "column",
    alignItems: "center",
  },
});
