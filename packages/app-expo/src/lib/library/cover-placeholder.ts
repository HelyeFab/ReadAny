/**
 * The drawing shown in place of a cover.
 *
 * A great many books arrive with no cover art at all — plain text files,
 * stripped EPUBs, anything converted — and a shelf of grey rectangles with
 * titles on them looks like a list that failed to load rather than a shelf.
 *
 * Stored as a mask: one flat colour plus an alpha channel, with the paper the
 * drawing was made on cut away. That way the card can tint it to whatever the
 * current theme is, instead of a cream rectangle glowing on a dark shelf.
 */
import type { ImageSourcePropType } from "react-native";

export const COVER_PLACEHOLDER: ImageSourcePropType = require("../../../assets/illustrations/book-stack.png");
