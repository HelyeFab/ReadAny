import { gzipSync, strToU8 } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { untar } from "./archive";
import { foldTerm } from "./fold";
import type { TermInput } from "./yomitan-import";

const stored: { title: string; terms: TermInput[] }[] = [];

vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("./yomitan-import", () => ({
  createDictionary: async (title: string) => {
    stored.push({ title, terms: [] });
    return stored.length;
  },
  insertTerms: async (id: number, terms: Iterable<TermInput>) => {
    const list = [...terms];
    stored[id - 1].terms.push(...list);
    return list.length;
  },
  setTermCount: async () => {},
}));

const { importStarDictFiles, isStarDict, SYNONYM_RULE } = await import("./stardict-import");

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

/** Build a StarDict set from [headword, article bytes] pairs. */
function buildStarDict(
  name: string,
  entries: [string, Uint8Array][],
  options: {
    sameTypeSequence?: string;
    offsetBits?: 64;
    synonyms?: [string, number][];
    dz?: boolean;
  } = {},
): Record<string, Uint8Array> {
  const dictParts: number[] = [];
  const idx: number[] = [];
  for (const [word, article] of entries) {
    idx.push(...strToU8(word), 0);
    if (options.offsetBits === 64) idx.push(...u32(0));
    idx.push(...u32(dictParts.length), ...u32(article.length));
    dictParts.push(...article);
  }
  const ifo = [
    "StarDict's dict ifo file",
    "version=3.0.0",
    `bookname=${name}`,
    `wordcount=${entries.length}`,
    options.sameTypeSequence ? `sametypesequence=${options.sameTypeSequence}` : "",
    options.offsetBits === 64 ? "idxoffsetbits=64" : "",
  ].join("\n");
  const dict = new Uint8Array(dictParts);
  const files: Record<string, Uint8Array> = {
    [`${name}/${name}.ifo`]: strToU8(ifo),
    [`${name}/${name}.idx`]: new Uint8Array(idx),
    [options.dz ? `${name}/${name}.dict.dz` : `${name}/${name}.dict`]: options.dz
      ? gzipSync(dict)
      : dict,
  };
  if (options.synonyms) {
    const syn: number[] = [];
    for (const [word, index] of options.synonyms) syn.push(...strToU8(word), 0, ...u32(index));
    files[`${name}/${name}.syn`] = new Uint8Array(syn);
  }
  return files;
}

beforeEach(() => {
  stored.length = 0;
});

describe("foldTerm", () => {
  it("lowercases and strips accents from alphabetic words", () => {
    expect(foldTerm("Été")).toBe("ete");
    expect(foldTerm("Città")).toBe("citta");
    expect(foldTerm("AÑO")).toBe("ano");
  });

  it("leaves Japanese and Korean intact", () => {
    expect(foldTerm("が")).toBe("が");
    expect(foldTerm("育てる")).toBe("育てる");
    expect(foldTerm("한국어")).toBe("한국어");
  });
});

describe("importStarDictFiles", () => {
  it("reads a dictzipped HTML dictionary with synonyms", async () => {
    const files = buildStarDict(
      "fr-en",
      [
        ["cheval", strToU8("<b>horse</b><br>noun &amp; more")],
        ["été", strToU8("<k>été</k><i>n.</i> summer<br/>2. been")],
      ],
      { sameTypeSequence: "h", synonyms: [["chevaux", 0]], dz: true },
    );
    expect(isStarDict(files)).toBe(true);

    const [info] = await importStarDictFiles(files);
    expect(info.title).toBe("fr-en");
    expect(info.termCount).toBe(3);

    const terms = stored[0].terms;
    expect(terms[0]).toMatchObject({ expression: "cheval", glossary: "horse\nnoun & more" });
    expect(terms[1]).toMatchObject({ expression: "été", glossary: "n. summer\n2. been" });
    // An inflection is stored as a pointer to its headword, not a copy.
    expect(terms[2]).toMatchObject({
      expression: "chevaux",
      glossary: "cheval",
      rules: SYNONYM_RULE,
      score: -1,
    });
  });

  it("reads typed fields without sametypesequence, and 64-bit offsets", async () => {
    const article = new Uint8Array([
      ...strToU8("t"),
      ...strToU8("ˈhaʊs"),
      0,
      ...strToU8("m"),
      ...strToU8("a building"),
      0,
      ...strToU8("W"),
      ...u32(3),
      1,
      2,
      3, // a sound clip the sheet cannot show
    ]);
    const files = buildStarDict("en", [["house", article]], { offsetBits: 64 });

    await importStarDictFiles(files);
    expect(stored[0].terms[0]).toMatchObject({
      expression: "house",
      reading: "ˈhaʊs",
      glossary: "a building",
    });
  });

  it("refuses a lone .ifo with a message naming the missing files", async () => {
    const files = buildStarDict("lonely", [["a", strToU8("b")]], { sameTypeSequence: "m" });
    const { "lonely/lonely.idx": _idx, ...withoutIdx } = files;
    await expect(importStarDictFiles(withoutIdx)).rejects.toThrow(/\.idx and \.dict/);
  });
});

describe("untar", () => {
  function tarEntry(name: string, data: Uint8Array): Uint8Array {
    const header = new Uint8Array(512);
    header.set(strToU8(name), 0);
    header.set(strToU8(`${data.length.toString(8).padStart(11, "0")}\0`), 124);
    header[156] = 0x30;
    header.set(strToU8("ustar"), 257);
    const body = new Uint8Array(Math.ceil(data.length / 512) * 512);
    body.set(data);
    const out = new Uint8Array(512 + body.length);
    out.set(header);
    out.set(body, 512);
    return out;
  }

  it("extracts regular files", () => {
    const a = tarEntry("dict/a.ifo", strToU8("bookname=x"));
    const b = tarEntry("dict/a.idx", new Uint8Array(700).fill(7));
    const tar = new Uint8Array(a.length + b.length + 1024);
    tar.set(a);
    tar.set(b, a.length);

    const files = untar(tar);
    expect(Object.keys(files)).toEqual(["dict/a.ifo", "dict/a.idx"]);
    expect(files["dict/a.idx"].length).toBe(700);
  });
});
