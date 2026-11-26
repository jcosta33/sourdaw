/** A reference to an object by its position: "the first track", "the second one", "track 2". */
const POSITION_REFERENCE =
    /\b(?:the\s+)?(?:(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final|next|previous|\d+(?:st|nd|rd|th))\s+(?:audio\s+|midi\s+|bus\s+)?(?:tracks?|ones?|channels?|buses|bus|clips?)|tracks?\s+\d+)\b/iu;

/** The first phrase in the text referring to an object by its position, which names it as a name does. */
export function readTrackPosition(text: string): string | undefined {
    return POSITION_REFERENCE.exec(text)?.[0];
}
