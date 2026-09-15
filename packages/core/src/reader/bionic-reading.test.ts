import { describe, expect, it } from "vitest";

import { bionicBoldLength, hasBionicCandidates, splitBionicText } from "./bionic-reading";

/** Reassemble the original text, to prove nothing is lost or duplicated. */
function rejoin(text: string): string {
  return splitBionicText(text)
    .map((t) => t.bold + t.rest)
    .join("");
}

/** Render as markdown-ish, so expectations read like what the eye would see. */
function render(text: string): string {
  return splitBionicText(text)
    .map((t) => (t.bold ? `[${t.bold}]${t.rest}` : t.rest))
    .join("");
}

describe("bionicBoldLength", () => {
  it.each([
    ["", 0],
    ["a", 1],
    ["of", 1],
    ["the", 1],
    ["read", 2],
    ["words", 2],
    ["boldly", 3],
    ["reading", 3],
    ["fixation", 4],
    ["attention", 4],
    ["information", 5],
    ["incomprehensibility", 8],
  ])("bolds %o to %i characters", (word, expected) => {
    expect(bionicBoldLength(word)).toBe(expected);
  });

  it("never bolds more than half a word", () => {
    for (let length = 2; length <= 40; length++) {
      const word = "x".repeat(length);
      expect(bionicBoldLength(word) / length, `length ${length}`).toBeLessThanOrEqual(0.5);
    }
  });

  it("tapers — a long word gets proportionally less bold than a short one", () => {
    const share = (length: number) => bionicBoldLength("x".repeat(length)) / length;
    expect(share(20)).toBeLessThan(share(4));
  });

  it("never bolds more than the word has", () => {
    for (let length = 0; length <= 40; length++) {
      expect(bionicBoldLength("x".repeat(length))).toBeLessThanOrEqual(length);
    }
  });
});

describe("splitBionicText", () => {
  it("bolds the front of each word", () => {
    expect(render("the quick brown fox")).toBe("[t]he [qu]ick [br]own [f]ox");
  });

  it("leaves punctuation and spacing alone", () => {
    expect(render("Hello, world!")).toBe("[He]llo, [wo]rld!");
  });

  it("keeps an apostrophe inside the word it belongs to", () => {
    expect(render("don't")).toBe("[do]n't");
    expect(render("it’s")).toBe("[it]’s");
  });

  it("handles accented letters as letters", () => {
    expect(render("café naïve")).toBe("[ca]fé [na]ïve");
  });

  it("treats a hyphenated compound as two words", () => {
    expect(render("well-known")).toBe("[we]ll-[kn]own");
  });

  it("leaves digits alone", () => {
    expect(render("chapter 12 of 30")).toBe("[cha]pter 12 [o]f 30");
  });

  it("leaves Japanese untouched", () => {
    expect(render("日本語のテキスト")).toBe("日本語のテキスト");
  });

  it("bolds the English in a mixed line and leaves the Japanese alone", () => {
    expect(render("the 日本語 word")).toBe("[t]he 日本語 [wo]rd");
  });

  it("leaves Cyrillic and Greek alone — this is a Latin-script feature", () => {
    expect(render("привет κόσμε")).toBe("привет κόσμε");
  });

  it("does not treat a lone apostrophe as a word", () => {
    expect(render("'")).toBe("'");
  });

  it("returns nothing for empty text", () => {
    expect(splitBionicText("")).toEqual([]);
  });

  it.each([
    "the quick brown fox",
    "Hello, world!",
    "don't stop — 日本語 — 12 chapters",
    "   leading and trailing   ",
    "\n\ttabs and newlines\n",
    "",
    "純粋な日本語",
    "a",
  ])("reassembles %o exactly", (text) => {
    expect(rejoin(text)).toBe(text);
  });

  it("is stable when run over its own output's text", () => {
    const once = rejoin("the quick brown fox");
    expect(rejoin(once)).toBe(once);
  });
});

describe("hasBionicCandidates", () => {
  it("is true for text with Latin letters", () => {
    expect(hasBionicCandidates("hello")).toBe(true);
    expect(hasBionicCandidates("日本語 and English")).toBe(true);
  });

  it("is false for text without any", () => {
    expect(hasBionicCandidates("日本語のテキスト")).toBe(false);
    expect(hasBionicCandidates("12 + 34 = 46")).toBe(false);
    expect(hasBionicCandidates("")).toBe(false);
  });
});
