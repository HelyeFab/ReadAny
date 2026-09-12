/**
 * The selection bridge injected into every page the web reader loads.
 *
 * The book reader gets its selections from our own reader template, which we
 * control. A web page is somebody else's document, so this has to be the
 * smallest thing that works: listen for a selection, post the text, and touch
 * nothing else. No styling, no DOM rewriting, no globals beyond one guard flag.
 *
 * Coordinates are deliberately not reported. Mapping them back through page
 * zoom and scroll was the fiddliest part of the book reader, and the web
 * reader's action bar is anchored to the bottom of the screen instead, which
 * needs none of it.
 */

export type WebBridgeMessage =
  | { type: "selection"; text: string }
  | { type: "selectionCleared" }
  | { type: "page"; url: string; title: string };

export const SELECTION_BRIDGE_JS = String.raw`
(function () {
  if (window.__readanyBridge) return;
  window.__readanyBridge = true;

  var lastText = "";
  var timer = null;

  function post(message) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    } catch (e) {}
  }

  function readSelection() {
    var selection = window.getSelection && window.getSelection();
    var text = selection ? String(selection) : "";
    text = text.replace(/\s+/g, " ").trim();
    if (text === lastText) return;
    lastText = text;
    post(text ? { type: "selection", text: text } : { type: "selectionCleared" });
  }

  function scheduleRead(delay) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(readSelection, delay);
  }

  document.addEventListener("selectionchange", function () { scheduleRead(180); }, true);
  // Lifting a finger after dragging the handles does not always fire
  // selectionchange on Android WebView, so the gesture end is a second trigger.
  document.addEventListener("touchend", function () { scheduleRead(60); }, true);
  document.addEventListener("mouseup", function () { scheduleRead(60); }, true);

  function postPage() {
    post({ type: "page", url: location.href, title: document.title || "" });
  }
  postPage();
  // Single-page sites swap the article without a navigation the WebView can see.
  window.addEventListener("popstate", function () { setTimeout(postPage, 300); });
})();
true;
`;

export function parseWebBridgeMessage(raw: string): WebBridgeMessage | null {
  try {
    const parsed = JSON.parse(raw) as WebBridgeMessage;
    if (parsed && typeof parsed.type === "string") return parsed;
  } catch {}
  return null;
}
