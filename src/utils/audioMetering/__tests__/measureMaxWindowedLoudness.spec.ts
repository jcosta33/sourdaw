import { describe, expect, it } from 'vitest';

import { measureMaxWindowedLoudness } from '../measureMaxWindowedLoudness';

const SAMPLE_RATE = 48_000;

/**
 * A 1 kHz sine whose amplitude is given in dBFS. BS.1770 is calibrated so a
 * stereo 1 kHz sine reads its own peak level in LUFS: a -23 dBFS sine in both
 * channels is -23 LUFS, which is what makes these expectations absolute figures
 * rather than comparisons against the implementation's own output.
 */
function sineAtDbfs(peakDbfs: number, length: number, startFrame = 0, target = new Float32Array(length)): Float32Array {
    const amplitude = 10 ** (peakDbfs / 20);
    for (let index = startFrame; index < length; index++) {
        target[index] = amplitude * Math.sin((2 * Math.PI * 1000 * index) / SAMPLE_RATE);
    }
    return target;
}

type ToneSpec = {
    readonly dbfs: number;
    readonly hz: number;
    readonly startFrame?: number;
    readonly endFrame?: number;
};

/** Writes a sine of the given frequency and amplitude over `[startFrame, endFrame)`. */
function writeTone(
    target: Float32Array,
    { dbfs, hz, startFrame = 0, endFrame = target.length }: ToneSpec
): Float32Array {
    const amplitude = 10 ** (dbfs / 20);
    for (let index = startFrame; index < endFrame; index++) {
        target[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / SAMPLE_RATE);
    }
    return target;
}

describe('measureMaxWindowedLoudness', () => {
    it('reads a steady -23 dBFS stereo sine as -23 LUFS over a 400 ms window', () => {
        const length = SAMPLE_RATE * 2;
        const tone = sineAtDbfs(-23, length);

        const result = measureMaxWindowedLoudness({
            channels: [tone, tone],
            length,
            sampleRate: SAMPLE_RATE,
            windowSeconds: 0.4,
        });

        expect(result).not.toBeNull();
        expect(Math.abs(result! - -23)).toBeLessThan(0.1);
    });

    it('refuses material shorter than the requested window instead of shrinking it', () => {
        const length = SAMPLE_RATE * 2;
        const tone = sineAtDbfs(-23, length);

        const result = measureMaxWindowedLoudness({
            channels: [tone, tone],
            length,
            sampleRate: SAMPLE_RATE,
            windowSeconds: 3,
        });

        expect(result).toBeNull();
    });

    it('reports the loudest window, not the programme mean', () => {
        // Two seconds: -33 dBFS until 1 s, then -23 dBFS. The mean of the two
        // halves is about -27.6 LUFS, so an averaging implementation cannot
        // pass this.
        const length = SAMPLE_RATE * 2;
        const channel = new Float32Array(length);
        channel.set(sineAtDbfs(-33, SAMPLE_RATE));
        sineAtDbfs(-23, length, SAMPLE_RATE, channel);

        const result = measureMaxWindowedLoudness({
            channels: [channel, channel],
            length,
            sampleRate: SAMPLE_RATE,
            windowSeconds: 0.4,
        });

        expect(result).not.toBeNull();
        expect(Math.abs(result! - -23)).toBeLessThan(0.15);
    });

    it('returns null when there are no samples to measure', () => {
        expect(
            measureMaxWindowedLoudness({
                channels: [new Float32Array(0)],
                length: 0,
                sampleRate: SAMPLE_RATE,
                windowSeconds: 0.4,
            })
        ).toBeNull();
    });

    it('returns null for digital silence, which has no defined loudness', () => {
        const length = SAMPLE_RATE;

        expect(
            measureMaxWindowedLoudness({
                channels: [new Float32Array(length)],
                length,
                sampleRate: SAMPLE_RATE,
                windowSeconds: 0.4,
            })
        ).toBeNull();
    });

    it('weighs 30 Hz well below 1 kHz, as the K-weighting high-pass does', () => {
        const length = SAMPLE_RATE * 2;
        const low = writeTone(new Float32Array(length), { dbfs: -23, hz: 30 });
        const high = writeTone(new Float32Array(length), { dbfs: -23, hz: 1000 });
        const window = { length, sampleRate: SAMPLE_RATE, windowSeconds: 0.4 };

        const lowLufs = measureMaxWindowedLoudness({ ...window, channels: [low, low] });
        const highLufs = measureMaxWindowedLoudness({ ...window, channels: [high, high] });

        expect(lowLufs).not.toBeNull();
        expect(highLufs).not.toBeNull();
        // The two tones carry identical amplitude, so the whole difference is
        // the RLB high-pass at its 38 Hz corner. Unfiltered they read alike.
        expect(highLufs! - lowLufs!).toBeGreaterThan(5);
        expect(highLufs! - lowLufs!).toBeLessThan(12);
    });

    it('weights the fourth and fifth channels at 1.41, as BS.1770 Table 4 does', () => {
        const length = SAMPLE_RATE * 2;
        const tone = writeTone(new Float32Array(length), { dbfs: -23, hz: 1000 });
        const window = { length, sampleRate: SAMPLE_RATE, windowSeconds: 0.4 };

        const five = measureMaxWindowedLoudness({ ...window, channels: [tone, tone, tone, tone, tone] });
        const two = measureMaxWindowedLoudness({ ...window, channels: [tone, tone] });

        expect(five).not.toBeNull();
        expect(two).not.toBeNull();
        // 3 x 1 + 2 x 1.41 against 2 x 1. Weighting all five equally would read
        // 3.98 LU, so the surround weight is the only figure that satisfies this.
        expect(Math.abs(five! - two! - 10 * Math.log10(5.82 / 2))).toBeLessThan(0.02);
    });

    it('measures the tail a whole number of hops never reaches, over a 400 ms window', () => {
        // 148799 frames is not a whole number of 100 ms hops: the last stepped
        // 400 ms window ends exactly at frame 144000, where the tone begins, so
        // every stepped window sees silence alone.
        const length = 148_799;
        const channel = writeTone(new Float32Array(length), { dbfs: -14, hz: 1000, startFrame: 144_000 });

        const result = measureMaxWindowedLoudness({
            channels: [channel, channel],
            length,
            sampleRate: SAMPLE_RATE,
            windowSeconds: 0.4,
        });

        expect(result).not.toBeNull();
        // The window flush with the end holds 4799 of its 19200 frames of tone.
        expect(Math.abs(result! - (-14 + 10 * Math.log10(4799 / 19_200)))).toBeLessThan(0.15);
    });

    it('measures the tail a whole number of hops never reaches, over a 3 s window', () => {
        const length = 148_799;
        const channel = writeTone(new Float32Array(length), { dbfs: -14, hz: 1000, startFrame: 144_000 });

        const result = measureMaxWindowedLoudness({
            channels: [channel, channel],
            length,
            sampleRate: SAMPLE_RATE,
            windowSeconds: 3,
        });

        expect(result).not.toBeNull();
        // The only stepped window is [0, 144000), which stops where the tone
        // starts; the window flush with the end holds 4799 of its 144000 frames.
        expect(Math.abs(result! - (-14 + 10 * Math.log10(4799 / 144_000)))).toBeLessThan(0.15);
    });

    it('steps the window by 100 ms, so a burst straddling window boundaries still reads', () => {
        const length = SAMPLE_RATE * 2;
        const channel = writeTone(new Float32Array(length), { dbfs: -40, hz: 1000 });
        writeTone(channel, {
            dbfs: -14,
            hz: 1000,
            startFrame: Math.round(0.65 * SAMPLE_RATE),
            endFrame: Math.round(1.05 * SAMPLE_RATE),
        });

        const result = measureMaxWindowedLoudness({
            channels: [channel, channel],
            length,
            sampleRate: SAMPLE_RATE,
            windowSeconds: 0.4,
        });

        expect(result).not.toBeNull();
        // The 400 ms burst sits across every 400 ms boundary: hopping by the
        // window length covers at most 250 ms of it and reads about -16.0 LUFS,
        // while the 100 ms refresh places a window over 350 ms of it.
        expect(Math.abs(result! - -14.58)).toBeLessThan(0.15);
    });
});
