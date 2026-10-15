import {
  AUTO,
  LANGUAGES,
  WEB_SERVICES,
  canUseTextApps,
  guessLanguage,
  languageName,
  loadWebLookupPrefs,
  normaliseLanguage,
  openInTextApp,
  openWebLookup,
  saveWebLookupPrefs,
} from "@/lib/dictionary/look-elsewhere";
import { radius, spacing, ui, useColors } from "@/styles/theme";
/**
 * The way out of the dictionary sheet: hand the selection to another app, or
 * look it up on the web in the languages the reader picks right there.
 *
 * Sits under the definitions rather than replacing them, because it is as
 * useful when the dictionary answered (a second opinion, a translation of the
 * whole phrase) as when it did not.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Text, TouchableOpacity, View } from "react-native";

interface Props {
  text: string;
  /** The book's own language metadata, if it has any. */
  language?: string;
}

type Picker = "from" | "to" | null;

export function LookElsewhere({ text, language }: Props) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const [from, setFrom] = useState(
    () => normaliseLanguage(language) ?? guessLanguage(text) ?? AUTO,
  );
  const [to, setTo] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWebLookupPrefs(i18n.language).then((prefs) => {
      if (!cancelled) setTo(prefs.to);
    });
    return () => {
      cancelled = true;
    };
  }, [i18n.language]);

  const chooseLanguage = (code: string) => {
    if (picker === "from") {
      setFrom(code);
    } else {
      setTo(code);
      void saveWebLookupPrefs({ to: code });
    }
    setPicker(null);
  };

  const openApps = async () => {
    try {
      await openInTextApp(text);
    } catch (err) {
      Alert.alert(
        t("dictionary.otherApps", "Other apps"),
        t(
          "dictionary.noTextApp",
          "No installed app accepts text to look up. Google Translate, DeepL or a dictionary app such as GoldenDict will add themselves here.",
        ),
      );
      console.warn("[Dictionary] PROCESS_TEXT failed:", err);
    }
  };

  const chip = (selected: boolean) => ({
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: selected ? colors.primary : colors.border,
    backgroundColor: selected ? colors.primary : "transparent",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  });
  const chipText = (selected: boolean) => ({
    fontSize: ui(13),
    color: selected ? colors.primaryForeground : colors.foreground,
  });

  const services =
    to === null
      ? []
      : WEB_SERVICES.map((service) => ({ service, url: service.url(text, from, to) })).filter(
          (entry): entry is { service: (typeof WEB_SERVICES)[number]; url: string } =>
            entry.url !== null,
        );

  const pickerOptions = picker === "from" ? [{ code: AUTO, name: "" }, ...LANGUAGES] : LANGUAGES;

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: spacing.sm,
        gap: spacing.sm,
      }}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}
      >
        <Text style={{ fontSize: ui(12), color: colors.mutedForeground }}>
          {t("dictionary.lookElsewhere", "Look up elsewhere")}
        </Text>
        <View style={{ flex: 1 }} />
        {canUseTextApps && (
          <TouchableOpacity onPress={() => void openApps()} style={chip(false)}>
            <Text style={chipText(false)}>{t("dictionary.otherApps", "Other apps")}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <TouchableOpacity
          onPress={() => setPicker(picker === "from" ? null : "from")}
          style={chip(picker === "from")}
        >
          <Text style={chipText(picker === "from")}>
            {from === AUTO ? t("dictionary.detectLanguage", "Detect") : languageName(from)} ▾
          </Text>
        </TouchableOpacity>
        <Text style={{ color: colors.mutedForeground }}>→</Text>
        <TouchableOpacity
          onPress={() => setPicker(picker === "to" ? null : "to")}
          style={chip(picker === "to")}
        >
          <Text style={chipText(picker === "to")}>{to ? languageName(to) : "…"} ▾</Text>
        </TouchableOpacity>
      </View>

      {picker !== null ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {pickerOptions.map((option) => {
            const selected = option.code === (picker === "from" ? from : to);
            return (
              <TouchableOpacity
                key={option.code}
                onPress={() => chooseLanguage(option.code)}
                style={chip(selected)}
              >
                <Text style={chipText(selected)}>
                  {option.code === AUTO ? t("dictionary.detectLanguage", "Detect") : option.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {services.map(({ service, url }) => (
            <TouchableOpacity
              key={service.id}
              onPress={() => void openWebLookup(url)}
              style={chip(false)}
            >
              <Text style={chipText(false)}>{service.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
