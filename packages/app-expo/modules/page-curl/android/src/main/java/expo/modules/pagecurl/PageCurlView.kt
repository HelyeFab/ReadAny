package expo.modules.pagecurl

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.Log
import android.view.animation.DecelerateInterpolator
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.net.URI
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

/** Bends a captured *page*, rather than rotating the entire reader viewport. */
class PageCurlView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  init { setWillNotDraw(false) }
  private val onReady by EventDispatcher<Unit>()
  private val onFinished by EventDispatcher<Unit>()
  private val decodeQueue = Executors.newSingleThreadExecutor()
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val meshWidth = 32
  private val meshHeight = 12
  private val vertices = FloatArray((meshWidth + 1) * (meshHeight + 1) * 2)
  private var bitmap: Bitmap? = null
  private var page: Bitmap? = null
  private var imageToken = 0
  private var progress = 0f
  private var direction = "next"
  private var dualPage = false
  private var animator: ValueAnimator? = null
  private var lastAnimateTarget: Float? = null
  private var drawLogged = false

  fun setImageUri(uri: String?) {
    imageToken++
    val token = imageToken
    animator?.cancel()
    bitmap?.recycle()
    page?.recycle()
    bitmap = null
    page = null
    lastAnimateTarget = null
    drawLogged = false
    invalidate()
    if (uri.isNullOrBlank()) return
    decodeQueue.execute {
      val file = try { if (uri.startsWith("file:")) URI(uri).path else uri } catch (_: Exception) { uri }
      val loaded = BitmapFactory.decodeFile(file)
      Log.i("ReadAnyPageCurl", "decoded=${loaded?.width}x${loaded?.height} path=$file")
      post {
        if (token != imageToken) { loaded?.recycle(); return@post }
        bitmap = loaded
        drawLogged = false
        rebuildPage()
        if (loaded != null) onReady(Unit)
        invalidate()
      }
    }
  }

  fun setProgress(value: Float) {
    animator?.cancel()
    progress = value.coerceIn(0f, 1f)
    invalidate()
  }

  fun setDirection(value: String) { direction = if (value == "prev") "prev" else "next"; rebuildPage(); invalidate() }
  fun setDualPage(value: Boolean) { if (dualPage != value) { dualPage = value; rebuildPage(); invalidate() } }

  fun animateTo(target: Float) {
    val end = target.coerceIn(0f, 1f)
    if (lastAnimateTarget == end) return
    lastAnimateTarget = end
    animator?.cancel()
    animator = ValueAnimator.ofFloat(progress, end).apply {
      duration = max(90L, ((kotlin.math.abs(end - progress) * 430f).toLong()))
      interpolator = DecelerateInterpolator(1.2f)
      addUpdateListener { progress = it.animatedValue as Float; invalidate() }
      addListener(object : android.animation.AnimatorListenerAdapter() {
        private var cancelled = false
        override fun onAnimationCancel(animation: android.animation.Animator) { cancelled = true }
        override fun onAnimationEnd(animation: android.animation.Animator) {
          if (!cancelled) onFinished(Unit)
        }
      })
      start()
    }
  }

  private fun rebuildPage() {
    page?.recycle()
    val source = bitmap
    page = if (source == null) null else if (!dualPage) source.copy(source.config ?: Bitmap.Config.ARGB_8888, false)
    else {
      val half = source.width / 2
      val x = if (direction == "next") half else 0
      Bitmap.createBitmap(source, x, 0, max(1, source.width - half), source.height)
    }
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (!drawLogged) {
      Log.i("ReadAnyPageCurl", "draw width=$width height=$height bitmap=${bitmap?.width} progress=$progress")
      drawLogged = true
    }
    val source = bitmap ?: return
    val turningPage = page ?: return
    if (width <= 0 || height <= 0) return
    val w = width.toFloat()
    val h = height.toFloat()
    val pageWidth = if (dualPage) w / 2f else w
    val spine = if (dualPage) w / 2f else if (direction == "next") 0f else w

    // The stationary half stays put until the sheet has crossed the spine.
    if (dualPage && progress < .96f) {
      val stationaryAlpha = if (progress <= .58f) 255 else ((.96f - progress) / .38f * 255f).toInt().coerceIn(0, 255)
      paint.alpha = stationaryAlpha
      val srcLeft = direction == "next"
      val src = android.graphics.Rect(if (srcLeft) 0 else source.width / 2, 0, if (srcLeft) source.width / 2 else source.width, source.height)
      val dst = android.graphics.RectF(if (srcLeft) 0f else pageWidth, 0f, if (srcLeft) pageWidth else w, h)
      canvas.drawBitmap(source, src, dst, paint)
    }

    // Move a diagonal crease inward from the outer corner. The front of the
    // sheet stays flat; only the lifted portion reflects across the crease.
    // Keeping that flat portion visible prevents the blank frame produced by
    // projecting the entire page edge-on at the halfway point.
    val folds = FloatArray(meshHeight + 1)
    for (row in 0..meshHeight) {
      val v = row.toFloat() / meshHeight
      val lowerCornerWeight = v * v
      val rowTurn = progress * (lowerCornerWeight +
        (1f - lowerCornerWeight) * progress * progress)
      val fold = pageWidth * (1f - rowTurn)
      folds[row] = fold
      for (col in 0..meshWidth) {
        val u = col.toFloat() / meshWidth
        val sourceX = u * pageWidth
        val lifted = max(0f, sourceX - fold)
        val radius = pageWidth * (.09f + .045f * sin(PI * progress).toFloat())
        val halfCylinder = PI.toFloat() * radius
        val projected = when {
          lifted <= 0f -> sourceX
          lifted < halfCylinder -> fold + radius * sin(lifted / radius)
          else -> fold - (lifted - halfCylinder)
        }
        val elevation = if (lifted > 0f && lifted < halfCylinder)
          radius * (1f - cos(lifted / radius)) else 0f
        val index = (row * (meshWidth + 1) + col) * 2
        vertices[index] = spine + (if (direction == "next") projected else -projected)
        vertices[index + 1] = v * h + elevation * (v - .5f) * .16f
      }
    }
    paint.alpha = 255
    canvas.drawBitmapMesh(turningPage, meshWidth, meshHeight, vertices, 0, null, 0, paint)

    // Paper back: a light veil over the reflected portion, leaving front
    // typography intact up to the diagonal fold.
    if (progress > .02f && progress < .99f) {
      val path = Path().apply {
        for (row in 0..meshHeight) {
          val x = spine + (if (direction == "next") folds[row] else -folds[row])
          val y = row.toFloat() / meshHeight * h
          if (row == 0) moveTo(x, y) else lineTo(x, y)
        }
        for (row in meshHeight downTo 0) {
          val index = (row * (meshWidth + 1) + meshWidth) * 2
          lineTo(vertices[index], vertices[index + 1])
        }
        close()
      }
      paint.color = Color.WHITE
      paint.alpha = (190f * sin(PI * progress)).toInt().coerceIn(0, 190)
      canvas.drawPath(path, paint)
      paint.color = Color.BLACK
      paint.alpha = 255
    }

    val edgePath = Path().apply {
      for (row in 0..meshHeight) {
        val x = spine + (if (direction == "next") folds[row] else -folds[row])
        val y = row.toFloat() / meshHeight * h
        if (row == 0) moveTo(x, y) else lineTo(x, y)
      }
    }
    val shadowStrength = sin(PI * progress).toFloat()
    for (stroke in 0..5) {
      val shadow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb((23f * shadowStrength * (1f - stroke / 6f)).toInt().coerceIn(0, 23), 0, 0, 0)
        strokeWidth = 8f + stroke * 8f
        style = Paint.Style.STROKE
      }
      canvas.drawPath(edgePath, shadow)
    }
  }

  override fun onDetachedFromWindow() {
    animator?.cancel()
    decodeQueue.shutdownNow()
    bitmap?.recycle()
    page?.recycle()
    bitmap = null
    page = null
    super.onDetachedFromWindow()
  }
}
