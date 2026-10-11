/**
 * Beats closer than this are one instant, and a note span no longer than this is
 * float noise left by a loop wrap, never a hit. Projected beats on non-dyadic grids
 * (thirds, fifths, twelfths) miss the exact value by about 1e-16 per beat at the
 * magnitudes a project reaches. One tick of the 480 PPQ file the export writes is
 * about 2e-3 beats, so this sits six orders of magnitude below any length a
 * musician can place.
 */
export const SAME_BEAT_TOLERANCE = 1e-9;
