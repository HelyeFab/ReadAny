package expo.modules.mlkitocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import androidx.core.os.bundleOf
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File

/**
 * Reads text out of a rectangle the user drew on a page.
 *
 * A great deal of Japanese worth reading is published as page images — sample
 * viewers, scans, manga — where there is no text to select and therefore
 * nothing for the dictionary or Sensei to work with. This turns a crop back
 * into text so the rest of the reading companion applies to it unchanged.
 *
 * Recognition is on-device. The image never leaves the phone, which matters
 * because the crop is of whatever page happened to be open.
 *
 * The preprocessing below is carried over from Translayer, where it was tuned
 * against a measured set of real screens rather than guessed at: the note there
 * records sigmoid contrast at k=7 producing about 40% fewer translation-
 * affecting failures than linear contrast, because hard clamping at 0 and 255
 * destroys the anti-aliased edge gradients the recogniser needs.
 */

/** Upscale small crops to a 1200px short side, capped at 3000 or 3x source. */
private const val TARGET_MIN_DIM = 1200
private const val MAX_DIM = 3000
private const val SIGMOID_K = 7f

class RecognizeOptions : Record {
  @Field val uri: String = ""
  /**
   * Crop rectangle as fractions of the image, 0..1.
   *
   * Fractions rather than pixels on purpose. The caller lays the capture out in
   * density-independent units and has no reliable way to learn the bitmap's
   * true pixel size, so passing pixels means guessing at a conversion and
   * cropping the wrong part of the page when the guess is wrong. Only this side
   * knows how big the bitmap actually is.
   */
  @Field val x: Double = 0.0
  @Field val y: Double = 0.0
  @Field val width: Double = 0.0
  @Field val height: Double = 0.0
  /** "japanese" or "latin". */
  @Field val language: String = "japanese"
}

class MlkitOcrModule : Module() {
  private var japanese: TextRecognizer? = null
  private var latin: TextRecognizer? = null

  private fun recognizerFor(language: String): TextRecognizer =
    if (language == "latin") {
      latin ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also { latin = it }
    } else {
      japanese
        ?: TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
          .also { japanese = it }
    }

  override fun definition() = ModuleDefinition {
    Name("MlkitOcr")

    OnDestroy {
      japanese?.close()
      latin?.close()
      japanese = null
      latin = null
    }

    AsyncFunction("recognize") { options: RecognizeOptions ->
      val source = decode(options.uri)
      val cropped = crop(source, options)
      if (cropped !== source) source.recycle()

      val prepared = preprocess(cropped)
      if (prepared !== cropped) cropped.recycle()

      try {
        val result = Tasks.await(recognizerFor(options.language).process(InputImage.fromBitmap(prepared, 0)))
        // Blocks come back in reading order for Japanese, including vertical
        // text, so joining them is closer to the page than joining lines.
        val blocks = result.textBlocks.map { it.text }
        bundleOf(
          "text" to result.text,
          "blocks" to blocks.toTypedArray(),
        )
      } finally {
        prepared.recycle()
      }
    }
  }

  private fun decode(uri: String): Bitmap {
    val path = when {
      uri.startsWith("file://") -> Uri.parse(uri).path
      uri.startsWith("/") -> uri
      else -> null
    } ?: throw CodedException("ERR_OCR_URI", "Expected a local file path, got: $uri", null)

    val file = File(path)
    if (!file.exists()) {
      throw CodedException("ERR_OCR_MISSING", "No such file: $path", null)
    }
    val options = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
    return BitmapFactory.decodeFile(path, options)
      ?: throw CodedException("ERR_OCR_DECODE", "Could not decode the capture at $path", null)
  }

  private fun crop(source: Bitmap, options: RecognizeOptions): Bitmap {
    if (options.width <= 0.0 || options.height <= 0.0) return source
    val left = (options.x * source.width).toInt().coerceIn(0, source.width - 1)
    val top = (options.y * source.height).toInt().coerceIn(0, source.height - 1)
    val right = ((options.x + options.width) * source.width).toInt().coerceIn(1, source.width)
    val bottom = ((options.y + options.height) * source.height).toInt().coerceIn(1, source.height)
    val rect = Rect(left, top, right, bottom)
    if (rect.width() < 2 || rect.height() < 2) return source
    return Bitmap.createBitmap(source, rect.left, rect.top, rect.width(), rect.height())
  }

  /** Scale, then greyscale, then sigmoid contrast, inverting for light-on-dark. */
  private fun preprocess(bitmap: Bitmap): Bitmap {
    val minDim = minOf(bitmap.width, bitmap.height)
    var scale = if (minDim < TARGET_MIN_DIM) (TARGET_MIN_DIM.toFloat() / minDim).coerceAtMost(3f) else 1f
    if (bitmap.width * scale > MAX_DIM || bitmap.height * scale > MAX_DIM) {
      scale = minOf(MAX_DIM.toFloat() / bitmap.width, MAX_DIM.toFloat() / bitmap.height)
    }
    val outW = (bitmap.width * scale).toInt().coerceAtLeast(1)
    val outH = (bitmap.height * scale).toInt().coerceAtLeast(1)

    val out = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG).apply {
      colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) })
    }
    Canvas(out).drawBitmap(bitmap, null, Rect(0, 0, outW, outH), paint)

    val base = sigmoidLut(SIGMOID_K)
    val lut = if (isDarkBackground(bitmap)) IntArray(256) { 255 - base[it] } else base
    applyGrayLut(out, lut)
    return out
  }

  private fun sigmoidLut(k: Float): IntArray {
    val s0 = 1.0 / (1.0 + Math.exp(k * 0.5))
    val s1 = 1.0 / (1.0 + Math.exp(-k * 0.5))
    val range = s1 - s0
    return IntArray(256) { i ->
      val x = i / 255.0
      val s = 1.0 / (1.0 + Math.exp(-k * (x - 0.5)))
      ((s - s0) / range * 255.0).toInt().coerceIn(0, 255)
    }
  }

  private fun applyGrayLut(bitmap: Bitmap, lut: IntArray) {
    val w = bitmap.width
    val h = bitmap.height
    val pixels = IntArray(w * h)
    bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
    for (i in pixels.indices) {
      val p = pixels[i]
      val a = (p ushr 24) and 0xff
      val v = lut[(p ushr 16) and 0xff]
      pixels[i] = (a shl 24) or (v shl 16) or (v shl 8) or v
    }
    bitmap.setPixels(pixels, 0, w, 0, 0, w, h)
  }

  /** Sampled at the edges, where the background is, not the middle where the text is. */
  private fun isDarkBackground(bitmap: Bitmap): Boolean {
    val w = bitmap.width
    val h = bitmap.height
    val margin = (minOf(w, h) * 0.05f).toInt().coerceAtLeast(1)
    val points = listOf(
      margin to margin,
      w - margin to margin,
      margin to h - margin,
      w - margin to h - margin,
      w / 2 to margin,
      w / 2 to h - margin,
      margin to h / 2,
      w - margin to h / 2,
    )
    var sum = 0
    for ((x, y) in points) {
      val px = bitmap.getPixel(x.coerceIn(0, w - 1), y.coerceIn(0, h - 1))
      sum += (Color.red(px) + Color.green(px) + Color.blue(px)) / 3
    }
    return sum / points.size < 100
  }
}
