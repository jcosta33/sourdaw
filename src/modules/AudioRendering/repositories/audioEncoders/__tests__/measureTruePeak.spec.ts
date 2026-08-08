import { describe, expect, it } from 'vitest';

import { measureTruePeak } from '../measureTruePeak';

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
