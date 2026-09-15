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
});
