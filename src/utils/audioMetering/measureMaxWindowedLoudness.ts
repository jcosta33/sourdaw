import { applyBiquad } from './applyBiquad';
import { createKWeightingFilters } from './createKWeightingFilters';
import { LOUDNESS_OFFSET, loudnessChannelWeight } from './loudnessScale';

/**
 * Loudest K-weighted window — the momentary (400 ms) and short-term (3 s)
 * maxima of EBU Tech 3341, read from one function by its window length.
 *
 * Deliberately ungated: a maximum is the loudest moment, and gating it against
 * the programme mean would hide exactly the peak the caller is asking about.
 * The gating that belongs to an *integrated* reading lives in
 * `measureIntegratedLoudness`.
 */

/** 100 ms, the refresh interval Tech 3341 specifies for both meters. */
const WINDOW_STEP_SECONDS = 0.1;

/**
 * Every window start frame: the Tech 3341 hop, plus one window flush with the
 * end of the render when the last hop leaves frames uncovered.
 *
 * Stepped windows reach only `(count - 1) * step + windowFrames`, so on a render
 * whose length is not a whole number of hops the final frames sit inside no
 * window at all. A passage that begins there would not reach the maximum, and a
 * render that is silent until that point would read as silence.
 */
function windowStartFrames(length: number, windowFrames: number, stepFrames: number): number[] {
    const starts: number[] = [];
    for (let start = 0; start + windowFrames <= length; start += stepFrames) {
        starts.push(start);
    }
    const finalStart = length - windowFrames;
    if (finalStart > (starts[starts.length - 1] ?? 0)) {
        starts.push(finalStart);
    }
    return starts;
}

export type MeasureMaxWindowedLoudnessInput = {
    channels: readonly Float32Array[];
    length: number;
    sampleRate: number;
    windowSeconds: number;
};

/**
 * Maximum window loudness in LUFS, or `null` when there is nothing to measure:
 * no samples, no channels, every window at digital silence (which has no
 * defined loudness), or material shorter than the requested window.
 *
 * Shorter material is refused rather than measured over a shrunken window. A
 * 3 s short-term maximum taken over 1.5 s carries the 3 s label while averaging
 * half as much material, so a caller comparing two renders would be subtracting
 * two different meters. The caller reports that meter as unavailable instead.
 */
export function measureMaxWindowedLoudness({
    channels,
    length,
    sampleRate,
    windowSeconds,
}: MeasureMaxWindowedLoudnessInput): number | null {
    const windowFrames = Math.round(windowSeconds * sampleRate);
    if (length <= 0 || channels.length === 0 || windowFrames <= 0 || length < windowFrames) {
        return null;
    }

    const stepFrames = Math.max(1, Math.round(WINDOW_STEP_SECONDS * sampleRate));
    const starts = windowStartFrames(length, windowFrames, stepFrames);
    const { shelf, highPass } = createKWeightingFilters(sampleRate);

    // Weighted mean square per window, summed across channels.
    const windowPower = new Float64Array(starts.length);
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
        const source = channels[channelIndex]!;
        const weighted = new Float64Array(length);
        for (let index = 0; index < length; index++) {
            const sample = source[index] ?? 0;
            weighted[index] = Number.isFinite(sample) ? sample : 0;
        }
        applyBiquad(weighted, shelf);
        applyBiquad(weighted, highPass);

        const weight = loudnessChannelWeight(channelIndex);
        for (let window = 0; window < starts.length; window++) {
            const start = starts[window]!;
            let sumSquares = 0;
            for (let offset = 0; offset < windowFrames; offset++) {
                const value = weighted[start + offset]!;
                sumSquares += value * value;
            }
            windowPower[window] = (windowPower[window] ?? 0) + (weight * sumSquares) / windowFrames;
        }
    }

    let maxPower = 0;
    for (const power of windowPower) {
        if (power > maxPower) {
            maxPower = power;
        }
    }
    if (maxPower <= 0) {
        return null;
    }

    return LOUDNESS_OFFSET + 10 * Math.log10(maxPower);
}
