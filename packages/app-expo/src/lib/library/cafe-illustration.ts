/**
 * The café illustrations used as the library backdrop.
 *
 * Stored as transparent PNGs with the paper cut away, so only the ink shows.
 * Kept as JPEGs they carried their own cream background, which at low opacity
 * over the app's own cream read as a visible rectangle rather than a drawing.
 *
 * One is chosen per app run rather than per render: re-picking on every render
 * would make the picture flicker as the screen re-renders, and re-picking on
 * every mount would change it while you navigate away and back.
 */
import type { ImageSourcePropType } from "react-native";

const CAFE_ILLUSTRATIONS: ImageSourcePropType[] = [
  require("../../../assets/illustrations/cafe/cafe_1.png"),
  require("../../../assets/illustrations/cafe/cafe_2.png"),
  require("../../../assets/illustrations/cafe/cafe_3.png"),
  require("../../../assets/illustrations/cafe/cafe_4.png"),
];

const chosen = CAFE_ILLUSTRATIONS[Math.floor(Math.random() * CAFE_ILLUSTRATIONS.length)];

/** The illustration for this run of the app. Stable until the app restarts. */
export function cafeIllustration(): ImageSourcePropType {
  return chosen;
}
