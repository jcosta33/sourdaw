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

/**
 * `namedNodes` key of the Auto Makeup twin of the built-in compressor and
 * limiter. The applier creates it when the switch is off; the binding map
 * schedules automation of every parameter that reaches the device's
 * `DynamicsCompressorNode` (the compressor's threshold, knee, ratio, attack
 * and release; the limiter's threshold and release) on it as well, so the
 * twin's measured makeup moves with the device's.
 */
export const COMPRESSOR_AUTO_MAKEUP_TWIN_NODE = 'autoMakeupTwin';
