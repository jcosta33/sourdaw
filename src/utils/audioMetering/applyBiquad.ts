import { type LoudnessBiquad } from './createKWeightingFilters';

/**
 * Applies one direct-form-I biquad over `samples`, in place.
 *
 * Shared by every loudness path so a gated integrated reading and a windowed
 * maximum filter the same signal through the same state machine; two
 * transcriptions of this loop could drift and make the two readings
 * incomparable.
 */
export function applyBiquad(
    samples: Float64Array,
    filter: LoudnessBiquad,
    state?: { x1: number; x2: number; y1: number; y2: number }
): void {
    let x1 = state?.x1 ?? 0;
    let x2 = state?.x2 ?? 0;
    let y1 = state?.y1 ?? 0;
    let y2 = state?.y2 ?? 0;

    for (let index = 0; index < samples.length; index++) {
        const x0 = samples[index]!;
        const y0 = filter.b0 * x0 + filter.b1 * x1 + filter.b2 * x2 - filter.a1 * y1 - filter.a2 * y2;
        samples[index] = y0;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
    }
    if (state) {
        state.x1 = x1;
        state.x2 = x2;
        state.y1 = y1;
        state.y2 = y2;
    }
}
