/**
 * Gives PDFs a cover by photographing their first page.
 *
 * Most PDFs carry no cover image — 95 of the 103 coverless books in a real
 * library here — so a shelf of them is a wall of placeholders. Their first page
 * is almost always a title page, which is exactly the picture we want.
 *
 * The work happens in an offscreen WebView because PDF.js is a browser library;
 * the same reader.html the reader itself uses is loaded, and the PDF is fetched
 * over the local file server so PDF.js can range-request the first page instead
 * of dragging a 130 MB textbook through memory.
 */
import { Asset } from "expo-asset";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

const READER_HTML_ASSET = Asset.fromModule(require("../../../assets/reader/reader.html"));

/** A first page is a page, not a chapter; if it takes this long something is wrong. */
const RENDER_TIMEOUT_MS = 60_000;

export interface PdfCoverWebViewHandle {
  /** Render page one of the PDF at `url`, as a JPEG data URL. */
  renderCover(url: string): Promise<string>;
}

interface Pending {
  resolve: (dataUrl: string) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export const PdfCoverWebView = forwardRef<PdfCoverWebViewHandle>(function PdfCoverWebView(_, ref) {
  const webViewRef = useRef<WebView>(null);
  const pending = useRef<Pending[]>([]);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const asset = READER_HTML_ASSET;
        await asset.downloadAsync();
        setHtmlUri(asset.localUri || asset.uri);
      } catch (err) {
        console.error("[PdfCover] Failed to load reader asset:", err);
      }
    })();
  }, []);

  const settle = useCallback((fn: (p: Pending) => void) => {
    const next = pending.current.shift();
    if (!next) return;
    clearTimeout(next.timeoutId);
    fn(next);
  }, []);

  // biome-ignore lint/suspicious/noExplicitAny: React Native WebView event type
  const handleMessage = useCallback(
    (event: any) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === "foliate-loaded" || msg.type === "ready") {
          setReady(true);
        } else if (msg.type === "pdfCover") {
          if (msg.error) settle((p) => p.reject(new Error(msg.error)));
          else if (msg.dataUrl) settle((p) => p.resolve(msg.dataUrl));
          else settle((p) => p.reject(new Error("Renderer returned no image")));
        }
      } catch {
        // Reader HTML chatters about other things; anything unparseable is not ours.
      }
    },
    [settle],
  );

  useImperativeHandle(ref, () => ({
    renderCover: (url: string) =>
      new Promise<string>((resolve, reject) => {
        if (!ready || !webViewRef.current) {
          reject(new Error("Cover renderer not ready"));
          return;
        }
        const timeoutId = setTimeout(() => {
          const i = pending.current.findIndex((p) => p.reject === reject);
          if (i >= 0) pending.current.splice(i, 1);
          reject(new Error("Timed out rendering PDF cover"));
        }, RENDER_TIMEOUT_MS);
        pending.current.push({ resolve, reject, timeoutId });

        webViewRef.current.injectJavaScript(`
          (async () => {
            try {
              if (!window._renderPDFCoverDataURL) throw new Error("Renderer missing from reader build");
              const dataUrl = await window._renderPDFCoverDataURL(${JSON.stringify(url)});
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pdfCover', dataUrl }));
            } catch (e) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pdfCover', error: String(e && e.message || e) }));
            }
          })();
          true;
        `);
      }),
  }));

  if (!htmlUri) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <WebView
        ref={webViewRef}
        source={{ uri: htmlUri }}
        onMessage={handleMessage}
        originWhitelist={["*"]}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        javaScriptEnabled
        domStorageEnabled
        // Offscreen: it must run, but it must never be seen or touched.
        style={styles.hidden}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  hidden: { width: 1, height: 1, opacity: 0 },
});
