/**
 * The café illustrations shown on empty screens.
 *
 * One is chosen per app run rather than per render: re-picking on every render
 * would make the picture flicker as the screen re-renders, and re-picking on
 * every mount would change it while you navigate away and back.
 */
import type { ImageSourcePropType } from "react-native";

const CAFE_ILLUSTRATIONS: ImageSourcePropType[] = [
  require("../../../assets/illustrations/cafe/cafe_1.jpg"),
  require("../../../assets/illustrations/cafe/cafe_2.jpg"),
  require("../../../assets/illustrations/cafe/cafe_3.jpg"),
  require("../../../assets/illustrations/cafe/cafe_4.jpg"),
];

const chosen = CAFE_ILLUSTRATIONS[Math.floor(Math.random() * CAFE_ILLUSTRATIONS.length)];

/** The illustration for this run of the app. Stable until the app restarts. */
export function cafeIllustration(): ImageSourcePropType {
  return chosen;
}
