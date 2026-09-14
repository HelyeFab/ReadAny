import { useWindowDimensions } from "react-native";
import { classifyViewport } from "../styles/viewport";

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const viewport = classifyViewport(width, height);
  const { isTablet, isTabletLandscape } = viewport;

  const horizontalPadding = isTabletLandscape ? 28 : isTablet ? 24 : 16;
  const contentMaxWidth = isTabletLandscape ? 1260 : isTablet ? 980 : width;
  const centeredContentWidth = Math.min(width - horizontalPadding * 2, contentMaxWidth);

  return {
    width,
    height,
    ...viewport,
    horizontalPadding,
    contentMaxWidth,
    centeredContentWidth,
  };
}
