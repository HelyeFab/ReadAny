/**
 * Starting points offered when the web reader has nothing open.
 *
 * All of these publish Japanese text that is free to read on the open web, and
 * all of them serve it as real text rather than page images, which is what the
 * selection bridge needs to be useful.
 */

export interface StarterSite {
  id: string;
  title: string;
  note: string;
  url: string;
}

export const STARTER_SITES: StarterSite[] = [
  {
    id: "aozora",
    title: "青空文庫",
    note: "Public-domain literature",
    url: "https://www.aozora.gr.jp/",
  },
  {
    id: "nhk-easy",
    title: "NHK News Web Easy",
    note: "News rewritten for learners, with furigana",
    url: "https://www3.nhk.or.jp/news/easy/",
  },
  {
    id: "nhk",
    title: "NHK ニュース",
    note: "Full-speed news",
    url: "https://www3.nhk.or.jp/news/",
  },
  {
    id: "tadoku",
    title: "Tadoku free books",
    note: "Graded readers, level 0 upward",
    url: "https://tadoku.org/japanese/free-books/",
  },
  {
    id: "wikipedia-ja",
    title: "ウィキペディア",
    note: "Whatever you were curious about",
    url: "https://ja.wikipedia.org/",
  },
];

/**
 * Turn whatever is in the address bar into something loadable. A bare domain
 * gets https, and anything that is clearly not a URL becomes a search.
 */
export function resolveInputToUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;

  const looksLikeHost = /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(trimmed);
  if (looksLikeHost) return `https://${trimmed}`;

  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}
