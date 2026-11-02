const { withMainActivity } = require('@expo/config-plugins');

// Honor's WebView renderer can retain the cover-screen viewport when Android
// moves this activity to the inner display. Restart only the reader renderer;
// ReaderScreen remounts its WebView when onRenderProcessGone fires.
module.exports = function withFoldableWebViewResize(config) {
  return withMainActivity(config, (cfg) => {
    const source = cfg.modResults.contents;
    if (source.includes('foldable-webview-resize:onConfigurationChanged')) return cfg;
    const classAnchor = 'class MainActivity : ReactActivity() {';
    const createAnchor = '  override fun onCreate(savedInstanceState: Bundle?) {';
    if (!source.includes(classAnchor) || !source.includes(createAnchor)) {
      throw new Error('withFoldableWebViewResize: MainActivity Kotlin anchors missing');
    }
    cfg.modResults.contents = source
      .replace(classAnchor, `${classAnchor}\n\n  private var lastFoldWidthDp = 0\n  private var foldRestartTask: Runnable? = null`)
      .replace(createAnchor, `  // foldable-webview-resize:onConfigurationChanged
  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
    super.onConfigurationChanged(newConfig)
    val nextWidth = newConfig.smallestScreenWidthDp
    if (nextWidth == lastFoldWidthDp) return
    lastFoldWidthDp = nextWidth

    val root = window.decorView
    foldRestartTask?.let { root.removeCallbacks(it) }
    val task = Runnable {
      fun restartReader(view: android.view.View) {
        if (view is android.webkit.WebView &&
            view.settings.userAgentString?.contains("ReadAnyReader") == true &&
            android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
          view.webViewRenderProcess?.terminate()
        }
        if (view is android.view.ViewGroup) {
          for (i in 0 until view.childCount) restartReader(view.getChildAt(i))
        }
      }
      restartReader(root)
      foldRestartTask = null
    }
    foldRestartTask = task
    root.postDelayed(task, 250L)
  }

${createAnchor}`)
      .replace('    super.onCreate(null)', '    lastFoldWidthDp = resources.configuration.smallestScreenWidthDp\n    super.onCreate(null)');
    return cfg;
  });
};
