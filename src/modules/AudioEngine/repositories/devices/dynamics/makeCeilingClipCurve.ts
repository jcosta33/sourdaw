/**
 * Resolution of the limiter's ceiling clip curve over the WaveShaper input
 * domain [-1, 1]. Odd-looking size on purpose: it is the transfer of a
 * per-sample hard clip, so the lattice has to be dense enough that linear
 * interpolation between neighbours stays within a whisper of the identity in
 * the pass band, while every value the curve can ever return stays at or
 * under the ceiling (interpolating between values that never exceed `C`
 * never exceeds `C`, so the cap itself is exact, not approximate).
 */
export const CEILING_CLIP_CURVE_SAMPLES = 16_385;

/**
 * The transfer the limiter's ceiling promises: identity for samples the
 * ceiling admits, hard stop at the ceiling for everything louder. WaveShaper
 * clamps inputs outside [-1, 1] to the curve endpoints, so an input far past
 * full scale lands on ±ceiling exactly — the advertised peak cap holds for
 * sustained and transient over-level input alike (issue #3736).
 */
export function makeCeilingClipCurve(ceilingGain: number): Float32Array<ArrayBuffer> {
    const curve = new Float32Array(CEILING_CLIP_CURVE_SAMPLES);
    const lastIndex = CEILING_CLIP_CURVE_SAMPLES - 1;
    for (let index = 0; index <= lastIndex; index++) {
        const input = (index / lastIndex) * 2 - 1;
        curve[index] = Math.max(-ceilingGain, Math.min(ceilingGain, input));
    }
    return curve;
}
