/**
 * The Dutch Oven `decay` law: the shared normalised-coefficient ↔ tail-length
 * mapping used by the reverb's descriptor, its panel readout, and its engines.
 *
 * Two distinct things are easy to conflate here:
 *
 * - **Stored decay** (`dutch-oven`'s `decay` parameter, the values in
 *   `SPACE_PRESETS`, and every automation lane pointed at it) is, and stays, a
 *   **unitless coefficient in 0…0.999** — that is what the descriptor declares
 *   (`unit: ''`, `maxValue: 0.999`), what projects already contain, and what
 *   the plate, spring, reverse and convolution engines have always read.
 *   Nothing here changes what a stored value means, so existing projects load
 *   and render with the tail their author dialled in.
 * - **Tail length** is the physical quantity an engine needs: an RT60 in
 *   seconds for the FDN, a stretch factor for a loaded IR in the convolution
 *   engine. The FDN used to skip this conversion and read the raw coefficient
 *   as an RT60, which pinned its tail to 0.1–1.0 s and made the top of the
 *   Decay knob unreachable. Both engines now derive their quantity from the
 *   law below, so one knob position means one tail length device-wide.
 *
 * The law is exponential, so equal knob travel is an equal *ratio* of tail
 * length rather than an equal number of seconds — the same reason
 * {@link ./audioLevelLaw} spends fader travel in decibels. A linear seconds
 * law would crush the entire useful 0.5–4 s region into the bottom eighth of
 * the control.
 *
 * Mirrors `crates/proof-chamber/src/decay_curve.rs`; the two are pinned
 * against each other in `__tests__/reverbDecayLaw.spec.ts`.
 */

/** Top of the declared `decay` range (`NativeDspDescriptors.ts`, `dutch-oven`). */
export const DECAY_MAX = 0.999;

/** Descriptor default for `decay` — the neutral centre of the law. */
export const DECAY_DEFAULT = 0.5;

/** Shortest RT60 the FDN's absorptive filters realise, in seconds. */
export const MIN_RT60_SECONDS = 0.1;

/** Longest RT60 the FDN's absorptive filters realise, in seconds. */
export const MAX_RT60_SECONDS = 30;

/** Shortest IR stretch the convolution engine accepts. */
export const MIN_IR_STRETCH = 0.25;

/** Longest IR stretch the convolution engine accepts. */
export const MAX_IR_STRETCH = 4;

/**
 * Maps a normalised `decay` onto `[min, max]` with a constant ratio per unit
 * of knob travel. Values outside 0…1 clamp rather than extrapolate, matching
 * the Rust side.
 */
function mapDecay({ decay, min, max }: { decay: number; min: number; max: number }): number {
    const normalised = Math.max(0, Math.min(1, decay));
    return min * (max / min) ** normalised;
}

/**
 * The FDN reverberation time, in seconds, that a normalised `decay` produces.
 *
 * `decayToRt60Seconds(0)` is 0.1 s, the descriptor default of 0.5 is ~1.73 s,
 * and the declared maximum of 0.999 reaches ~29.8 s.
 */
export function decayToRt60Seconds(decay: number): number {
    return mapDecay({ decay, min: MIN_RT60_SECONDS, max: MAX_RT60_SECONDS });
}

/**
 * The convolution IR stretch factor that a normalised `decay` produces.
 *
 * Unity — the IR at its natural length — sits on the descriptor default of
 * 0.5, so the neutral knob position leaves a loaded IR alone.
 */
export function decayToIrStretch(decay: number): number {
    return mapDecay({ decay, min: MIN_IR_STRETCH, max: MAX_IR_STRETCH });
}

/**
 * Inverse of {@link decayToRt60Seconds}: the normalised `decay` that produces
 * a given RT60. Used when a caller knows the tail it wants in seconds and has
 * to write the stored coefficient.
 */
export function rt60SecondsToDecay(seconds: number): number {
    const clamped = Math.max(MIN_RT60_SECONDS, Math.min(MAX_RT60_SECONDS, seconds));
    return Math.log(clamped / MIN_RT60_SECONDS) / Math.log(MAX_RT60_SECONDS / MIN_RT60_SECONDS);
}
