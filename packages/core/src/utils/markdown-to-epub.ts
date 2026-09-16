import MarkdownIt from "markdown-it";
import markdownItKatex from "@vscode/markdown-it-katex";
import { buildStoreOnlyZip } from "./store-only-zip";

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Convert a Markdown document to an EPUB that the normal reader can paginate. */
export async function markdownToEpubBytes(bytes: Uint8Array, fileName: string): Promise<{ epubBytes: Uint8Array; bookTitle: string }> {
  const source = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  const markdown = new MarkdownIt({ html: false, xhtmlOut: true, linkify: true, typographer: true });
  markdown.use(markdownItKatex, {
    throwOnError: false,
    strict: false,
    // MathML is self-contained inside the generated EPUB. KaTeX's HTML output
    // depends on a stylesheet and font bundle that a local book cannot fetch.
    output: "mathml",
  });
  const tokens = markdown.parse(source, {});
  const headings: { title: string; id: string }[] = [];
  let firstHeading = "";
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]!;
    if (token.type !== "heading_open") continue;
    const title = tokens[i + 1]!.content.trim();
    if (!firstHeading && token.tag === "h1") firstHeading = title;
    const id = `heading-${headings.length + 1}`;
    token.attrSet("id", id);
    headings.push({ title, id });
  }
  const bookTitle = firstHeading || fileName.replace(/\.(md|markdown)$/i, "") || "Untitled";
  const body = markdown.renderer.render(tokens, markdown.options, {});
  const encoder = new TextEncoder();
  const toc = (headings.length ? headings : [{ title: bookTitle, id: "top" }])
    .map((heading, i) => `<navPoint id="nav-${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(heading.title)}</text></navLabel><content src="OEBPS/chapter.xhtml#${heading.id}"/></navPoint>`)
    .join("\n");
  const css = `body { line-height: 1.55; overflow-wrap: break-word; } pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: .5em; background: #eee; } code { font-family: monospace; } table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #888; padding: .3em; } blockquote { border-left: 3px solid #888; margin-left: 0; padding-left: 1em; } img { max-width: 100%; height: auto; } .katex-block { display: block; max-width: 100%; margin: 1em 0; overflow-x: auto; text-align: center; } math { font-size: 1.05em; }`;
  const identifier = `readany-markdown-${bytes.length}-${fileName}`;
  const entries = [
    { name: "mimetype", data: encoder.encode("application/epub+zip") },
    { name: "META-INF/container.xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`) },
    { name: "toc.ncx", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="book-id"/><meta name="dtb:depth" content="1"/></head><docTitle><text>${escapeXml(bookTitle)}</text></docTitle><navMap>${toc}</navMap></ncx>`) },
    { name: "style.css", data: encoder.encode(css) },
    { name: "OEBPS/chapter.xhtml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(bookTitle)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head><body><div id="top"></div>${body}</body></html>`) },
    { name: "content.opf", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(bookTitle)}</dc:title><dc:language>en</dc:language><dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier></metadata><manifest><item id="chapter" href="OEBPS/chapter.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>`) },
  ];
  return { epubBytes: buildStoreOnlyZip(entries), bookTitle };
}
