import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every query's bound values, so tests can see which candidates were tried. */
const queries: unknown[][] = [];
let rows: Record<string, unknown>[] = [];
/** What each query returns; the default hands back `rows` every time. */
let respond: (call: number) => Record<string, unknown>[] = () => rows;

vi.mock("./yomitan-import", () => ({
  getDictDb: async () => ({
    getAllAsync: async (_sql: string, ...params: unknown[]) => {
      queries.push(params);
      return respond(queries.length);
    },
    getFirstAsync: async () => ({ n: 1 }),
  }),
}));

const { lookup, lookupPhrase } = await import("./lookup");

beforeEach(() => {
  queries.length = 0;
  rows = [];
  respond = () => rows;
});

describe("lookup", () => {
  it("tries the folded form and French plurals", async () => {
    await lookup("Chevaux");
    const params = queries[0];
    expect(params).toContain("chevaux");
    expect(params).toContain("cheval");
  });

  it("strips an elided article", async () => {
    await lookup("l'homme");
    expect(queries[0]).toContain("homme");
  });

  it("ranks an exact match above a folded one", async () => {
    rows = [
      { title: "d", expression: "ete", reading: "", glossary: "folded", score: 0 },
      { title: "d", expression: "été", reading: "", glossary: "exact", score: 0 },
    ];
    const found = await lookup("été");
    expect(found.map((d) => d.glossary)).toEqual(["exact", "folded"]);
  });
});

describe("StarDict inflections", () => {
  it("shows the headword an inflection points at, ranked as the form looked up", async () => {
    const all = [
      {
        dictionary_id: 1,
        title: "fr",
        expression: "allions",
        reading: "",
        glossary: "aller",
        score: -1,
        rules: "stardict-syn",
      },
      {
        dictionary_id: 1,
        title: "fr",
        expression: "aller",
        reading: "",
        glossary: "to go",
        score: 0,
        rules: "",
      },
    ];
    // First query finds the pointer; the second resolves it.
    respond = (call) => (call === 1 ? [all[0]] : [all[1]]);
    const found = await lookup("allions");
    expect(found).toEqual([
      { dictionary: "fr", expression: "aller", reading: "", glossary: "to go", score: -1 },
    ]);
    expect(queries[1]).toEqual(["fr", 1, "aller", "stardict-syn"]);
  });
});

describe("lookupPhrase", () => {
  it("keeps accented and Cyrillic words whole", async () => {
    rows = [{ title: "d", expression: "x", reading: "", glossary: "g", score: 0 }];
    const hits = await lookupPhrase("La città è bella, правда");
    expect(hits.map((h) => h.surface)).toEqual(["La", "città", "bella", "правда"]);
  });
});
