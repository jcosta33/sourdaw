export const SAMPLE_RATE = 44100;
export const TWO_PI = Math.PI * 2;

/**
 * Default Q of every factory filter whose spec omits one: 0.707, the rounded
 * 1/√2 maximally-flat (Butterworth) value. Kept as the rounded literal — not
 * `Math.SQRT1_2` — because the shipped filter tuning and its specs pin this
 * exact number; the full-precision constant is a different, slightly brighter
 * filter.
 */
export const BUTTERWORTH_Q = 0.707;
