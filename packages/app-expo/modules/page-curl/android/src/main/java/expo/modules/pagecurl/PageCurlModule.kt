package expo.modules.pagecurl

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PageCurlModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PageCurl")
    View(PageCurlView::class) {
      Events("onReady", "onFinished")
      Prop("imageUri") { view, uri: String? -> view.setImageUri(uri) }
      Prop("progress") { view, progress: Float -> view.setProgress(progress) }
      Prop("direction") { view, direction: String -> view.setDirection(direction) }
      Prop("dualPage") { view, dual: Boolean -> view.setDualPage(dual) }
      Prop("animateTo") { view, target: Float? -> target?.let(view::animateTo) }
    }
  }
}
