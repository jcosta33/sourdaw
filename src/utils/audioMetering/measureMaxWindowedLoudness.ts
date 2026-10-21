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

/** Streaming counterpart to the batch window law: hop windows and the final end-aligned window. */
export function createMaxWindowedLoudnessAccumulator(input: { numberOfChannels: number; sampleRate: number }) {
    const lengths = [0.4, 3].map((seconds) => Math.round(seconds * input.sampleRate));
    const step = Math.round(WINDOW_STEP_SECONDS * input.sampleRate);
    if (input.numberOfChannels < 1 || lengths.some((length) => length < 1) || step < 1) {
        throw new Error('Invalid windowed loudness shape.');
    }
    const { shelf, highPass } = createKWeightingFilters(input.sampleRate);
    const filters = Array.from({ length: input.numberOfChannels }, () => ({
        shelf: { x1: 0, x2: 0, y1: 0, y2: 0 },
        highPass: { x1: 0, x2: 0, y1: 0, y2: 0 },
        samples: new Float64Array(4096),
    }));
    const history = new Float64Array(lengths[1]!);
    const sums = [0, 0];
    const maxima = [0, 0];
    let frames = 0;
    return {
        push(channels: readonly Float32Array[]) {
            const length = channels[0]?.length ?? 0;
            if (channels.length !== input.numberOfChannels || channels.some((channel) => channel.length !== length)) {
                throw new Error('Invalid windowed loudness PCM block.');
            }
            for (let start = 0; start < length; start += 4096) {
                const count = Math.min(4096, length - start);
                filters.forEach((filter, channel) => {
                    const samples = filter.samples.subarray(0, count);
                    for (let frame = 0; frame < count; frame++) {
                        const value = channels[channel]![start + frame]!;
                        samples[frame] = Number.isFinite(value) ? value : 0;
                    }
                    applyBiquad(samples, shelf, filter.shelf);
                    applyBiquad(samples, highPass, filter.highPass);
                });
                for (let frame = 0; frame < count; frame++) {
                    let power = 0;
                    filters.forEach((filter, channel) => {
                        power += loudnessChannelWeight(channel) * filter.samples[frame]! ** 2;
                    });
                    for (let window = 0; window < lengths.length; window++) {
                        const windowFrames = lengths[window]!;
                        const old = frames >= windowFrames ? history[(frames - windowFrames) % history.length]! : 0;
                        sums[window] = sums[window]! + power - old;
                        if (frames + 1 >= windowFrames && (frames + 1 - windowFrames) % step === 0) {
                            maxima[window] = Math.max(maxima[window]!, sums[window]! / windowFrames);
                        }
                    }
                    history[frames % history.length] = power;
                    frames++;
                }
            }
        },
        finish() {
            return lengths.map((windowFrames, index) => {
                if (frames < windowFrames) return null;
                const power = Math.max(maxima[index]!, sums[index]! / windowFrames);
                return power > 0 ? LOUDNESS_OFFSET + 10 * Math.log10(power) : null;
            });
        },
    };
}

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
