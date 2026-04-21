/**
 * LUFS / EBU R128 loudness metering.
 *
 * TODO: K-weighting is approximated with a first-order high-frequency emphasis filter.
 * For production-grade LUFS, an AudioWorklet with proper biquad K-weighting filters would be ideal.
 */

/**
 * Compute momentary loudness (400ms window) in LUFS from raw PCM samples.
 * Uses a simplified K-weighting approximation.
 */
export function computeMomentaryLUFS(samples: Float32Array, sampleRate = 48000): number {
    if (samples.length === 0) {
        return -70;
    }

    const windowSamples = Math.min(samples.length, Math.floor(sampleRate * 0.4));
    const start = samples.length - windowSamples;

    let sumSquares = 0;
    let prevSample = 0;
    for (let index = start; index < samples.length; index++) {
        const state = samples[index]!;
        const filtered = state - 0.85 * prevSample;
        prevSample = state;
        sumSquares += filtered * filtered;
    }

    const meanSquare = sumSquares / windowSamples;

    if (meanSquare <= 0) {
        return -70;
    }

    const lufs = -0.691 + 10 * Math.log10(meanSquare);
    return Math.max(-70, lufs);
}
