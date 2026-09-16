import { describe, expect, it } from "vitest";
import { inspectEpubBytes, withEpubPackageResourceReader } from "../epub/inspect";
import { markdownToEpubBytes } from "./markdown-to-epub";

describe("Markdown book conversion", () => {
  it("creates a readable EPUB with headings, tables, code, and safe XHTML", async () => {
    const text = '# A & B\n\n## Chapter 1\n\n- **bold** item\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n<script>alert(1)</script>\n';
    const result = await markdownToEpubBytes(new TextEncoder().encode(text), "fallback.md");
    expect(result.bookTitle).toBe("A & B");
    const inspected = await inspectEpubBytes(result.epubBytes);
    expect(inspected.spine.count).toBe(1);
    expect(inspected.toc.items.map((item) => item.label)).toEqual(["A & B", "Chapter 1"]);
    const chapter = await withEpubPackageResourceReader(result.epubBytes, ({ readTextEntry }) => readTextEntry("OEBPS/chapter.xhtml"));
    expect(chapter).toContain("<strong>bold</strong>");
    expect(chapter).toContain("<table>");
    expect(chapter).toContain("const x = 1;");
    expect(chapter).toContain("&lt;script&gt;");
    expect(chapter).not.toContain("<script>");
  });

  it("renders inline and display LaTeX as self-contained MathML", async () => {
    const text = "# Mathematics\n\nEuler wrote $e^{i\\pi}+1=0$.\n\n$$\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$\n";
    const result = await markdownToEpubBytes(new TextEncoder().encode(text), "math.md");
    const chapter = await withEpubPackageResourceReader(result.epubBytes, ({ readTextEntry }) =>
      readTextEntry("OEBPS/chapter.xhtml"),
    );
    expect(chapter).toContain("<math");
    expect(chapter).toContain("e^{i\\pi}+1=0");
    expect(chapter).toContain('class="katex-block"');
    expect(chapter).toContain("b^2-4ac");
  });

  it("keeps currency dollar signs as ordinary text", async () => {
    const text = "The first edition costs $20, and the bundle costs $30.";
    const result = await markdownToEpubBytes(new TextEncoder().encode(text), "prices.md");
    const chapter = await withEpubPackageResourceReader(result.epubBytes, ({ readTextEntry }) =>
      readTextEntry("OEBPS/chapter.xhtml"),
    );
    expect(chapter).toContain("$20");
    expect(chapter).toContain("$30");
    expect(chapter).not.toContain("<math");
  });
});
