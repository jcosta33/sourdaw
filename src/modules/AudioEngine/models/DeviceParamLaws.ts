/**
 * Device-parameter laws shared between a built-in device's static applier and
 * the offline automation binding map (`services/deviceResolution.ts`).
 *
 * The binding map must apply the same per-parameter conversion the static
 * applier applies, or enabling automation changes the render law (issue
 * #3738). Both sides import these constants rather than restating them, so a
 * change to one cannot silently leave the other behind. This file may not
 * import from `repositories/` — it exists to be importable from both sides.
 */

/**
 * Floor for the flanger's base delay tap. `applyFlangerParams` never lets the
 * base delay drop below this; the offline binding's conversion applies the
 * same floor. In seconds; the descriptor declares `flanger-depth` in ms.
 */
export const FLANGER_MIN_DELAY_SECONDS = 0.001;
