import { describe, expect, it } from 'vitest';

import { measureTruePeak } from '../measureTruePeak';

const TRUE_PEAK_TAIL_FRAMES = 11;

function withTrailingZeros(channel: Float32Array): Float32Array {
    const padded = new Float32Array(channel.length + TRUE_PEAK_TAIL_FRAMES);
    padded.set(channel);
    return padded;
}

function expectMatchesZeroPaddedOracle(channels: readonly Float32Array[], length: number): void {
    const logicalChannels = channels.map((channel) => channel.slice(0, length));
    const paddedChannels = logicalChannels.map(withTrailingZeros);
    const expected = measureTruePeak({ channels: paddedChannels, length: length + TRUE_PEAK_TAIL_FRAMES });

    expect(measureTruePeak({ channels, length })).toBeCloseTo(expected, 12);
}

describe('measureTruePeak', () => {
    it('returns 0 for empty input (no samples)', () => {
        const result = measureTruePeak({ channels: [new Float32Array(0)], length: 0 });

        expect(result).toBe(0);
    });

    it('returns 0 for an empty channel list', () => {
        const result = measureTruePeak({ channels: [], length: 0 });

        expect(result).toBe(0);
    });

    it('produces a finite, non-zero reading for a full-scale DC signal', () => {
        // A constant 1.0 signal: the 4x oversampling polyphase filter
        // reconstructs it at multiple phases, and the peak is the maximum
        // phase's coefficient sum.
        const dc = new Float32Array(100).fill(1);

        const result = measureTruePeak({ channels: [dc], length: dc.length });

        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeGreaterThan(0.5);
    });

    it('produces a bounded reconstruction for a single impulse', () => {
        // An isolated impulse at 0.8: the polyphase filter spreads it across
        // taps, so the peak is the max coefficient × impulse amplitude.
        const impulse = new Float32Array(50);
        impulse[25] = 0.8;

        const result = measureTruePeak({ channels: [impulse], length: impulse.length });

        // The peak must be positive and proportional to the impulse amplitude.
        expect(result).toBeGreaterThan(0.5);
        // The filter should not amplify an impulse above the input level
        // significantly (ringing is bounded).
        expect(result).toBeLessThan(1.0);
    });

    it('matches an independently zero-padded oracle for impulses at either buffer boundary', () => {
        const leading = new Float32Array(48);
        leading[0] = 1;
        const trailing = new Float32Array(48);
        trailing[trailing.length - 1] = 1;

        expectMatchesZeroPaddedOracle([leading], leading.length);
        expectMatchesZeroPaddedOracle([trailing], trailing.length);
    });

    it.each(Array.from({ length: TRUE_PEAK_TAIL_FRAMES }, (_, index) => index + 1))(
        'matches an independently zero-padded oracle for a %i-frame buffer',
        (length) => {
            const samples = new Float32Array(length);
            samples[length - 1] = 0.25 + length / 20;

            expectMatchesZeroPaddedOracle([samples], length);
        }
    );

    it('drains every channel while preserving silence and non-finite sanitization', () => {
        const quietTrailing = new Float32Array(7);
        quietTrailing[quietTrailing.length - 1] = 0.25;
        const loudTrailing = new Float32Array(7);
        loudTrailing[loudTrailing.length - 1] = 0.9;
        const invalid = new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0]);
        const silence = new Float32Array(7);

        expectMatchesZeroPaddedOracle([quietTrailing, loudTrailing, invalid, silence], quietTrailing.length);
        expect(measureTruePeak({ channels: [silence], length: silence.length })).toBe(0);
        expect(Number.isFinite(measureTruePeak({ channels: [invalid], length: invalid.length }))).toBe(true);
    });

    it('uses explicit zeros after the logical length instead of reading the channel backing array', () => {
        const backing = new Float32Array(16);
        backing[3] = 0.5;
        backing[4] = 100;
        backing[5] = -100;

        expectMatchesZeroPaddedOracle([backing], 4);
    });

    it('measures inter-sample peaks that exceed the sample peak', () => {
        // A signal that jumps between +1 and -1 at the Nyquist edge produces
        // inter-sample peaks above the sample peak due to reconstruction.
        // Full-scale alternating: 1, -1, 1, -1...
        const alternating = new Float32Array(200);
        for (let i = 0; i < alternating.length; i += 1) {
            alternating[i] = i % 2 === 0 ? 1 : -1;
        }

        const truePeak = measureTruePeak({ channels: [alternating], length: alternating.length });
        const samplePeak = 1.0;

        // The true-peak reconstruction of a full-scale alternating signal
        // should exceed the sample peak — this is the entire reason true-peak
        // exists as a separate measurement.
        expect(truePeak).toBeGreaterThan(samplePeak);
    });

    it('returns the higher peak across multiple channels', () => {
        const quiet = new Float32Array(100).fill(0.3);
        const loud = new Float32Array(100).fill(0.9);

        const result = measureTruePeak({ channels: [quiet, loud], length: 100 });

        // The louder channel should dominate the reading.
        expect(result).toBeGreaterThan(0.85);
    });

    it('zeroes non-finite samples instead of propagating NaN/Infinity', () => {
        const buf = new Float32Array(100).fill(0.5);
        buf[10] = Number.NaN;
        buf[20] = Number.POSITIVE_INFINITY;
        buf[30] = Number.NEGATIVE_INFINITY;

        const result = measureTruePeak({ channels: [buf], length: buf.length });

        // Result must be finite (NaN/Inf were zeroed, not propagated).
        expect(Number.isFinite(result)).toBe(true);
    });

    it('the result is proportional to input amplitude (linear scaling)', () => {
        const full = new Float32Array(100).fill(1);
        const half = new Float32Array(100).fill(0.5);

        const fullPeak = measureTruePeak({ channels: [full], length: full.length });
        const halfPeak = measureTruePeak({ channels: [half], length: half.length });

        // Halving the amplitude should roughly halve the true-peak (linear system).
        expect(halfPeak).toBeCloseTo(fullPeak * 0.5, 2);
    });
});
