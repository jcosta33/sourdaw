import { describe, expect, it } from 'vitest';

import { createTruePeakAccumulator, measureTruePeak } from '../measureTruePeak';

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
    it.each([
        { number: 15, frequencyDivisor: 4, amplitude: 0.5, phaseDegrees: 0, referenceDbtp: -6 },
        { number: 16, frequencyDivisor: 4, amplitude: 0.5, phaseDegrees: 45, referenceDbtp: -6 },
        { number: 17, frequencyDivisor: 6, amplitude: 0.5, phaseDegrees: 60, referenceDbtp: -6 },
        { number: 18, frequencyDivisor: 8, amplitude: 0.5, phaseDegrees: 67.5, referenceDbtp: -6 },
        { number: 19, frequencyDivisor: 4, amplitude: 1.41, phaseDegrees: 45, referenceDbtp: 3 },
    ])(
        'matches EBU Tech 3341 Table 1 case $number',
        ({ number, frequencyDivisor, amplitude, phaseDegrees, referenceDbtp }) => {
            const sampleRate = 48_000;
            const frameCount = sampleRate / 10;
            const fadeFrames = sampleRate / 100;
            const phase = (phaseDegrees * Math.PI) / 180;
            const frequency = sampleRate / frequencyDivisor;
            const tone = new Float32Array(frameCount);

            for (let frame = 0; frame < frameCount; frame += 1) {
                const fadeIn = Math.min(frame / fadeFrames, 1);
                const fadeOut = Math.min((frameCount - 1 - frame) / fadeFrames, 1);
                const envelope = Math.min(fadeIn, fadeOut);
                const angle = (2 * Math.PI * frequency * frame) / sampleRate + phase;
                tone[frame] = amplitude * envelope * Math.sin(angle);
            }

            const measuredLinear = measureTruePeak({ channels: [tone, tone.slice()], length: frameCount });
            const measuredDbtp = 20 * Math.log10(measuredLinear);
            const errorDb = measuredDbtp - referenceDbtp;

            console.info(
                `EBU Tech 3341 case ${number}: linear=${measuredLinear.toFixed(8)}, measured=${measuredDbtp.toFixed(4)} dBTP, reference=${referenceDbtp.toFixed(1)} dBTP, error=${errorDb.toFixed(4)} dB`
            );

            expect(errorDb, `case ${number} error ${errorDb.toFixed(4)} dB`).toBeGreaterThanOrEqual(-0.4);
            expect(errorDb, `case ${number} error ${errorDb.toFixed(4)} dB`).toBeLessThanOrEqual(0.2);
            if (number === 19) {
                expect(measuredLinear).toBeGreaterThan(1);
            }
        }
    );

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

describe('incremental true peak', () => {
    it('retains every phase/history and drains the final tap exactly once across partitions', () => {
        const tone = Float32Array.from({ length: 9001 }, (_, i) => Math.sin(i * 1.3));
        tone[0] = 1.4;
        tone[tone.length - 1] = -1.6;
        const expected = measureTruePeak({ channels: [tone], length: tone.length });
        for (const size of [1, 997, 4096]) {
            const meter = createTruePeakAccumulator(1);
            for (let start = 0; start < tone.length; start += size) meter.push([tone.subarray(start, start + size)]);
            expect(meter.finish()).toBeCloseTo(expected, 12);
            expect(meter.finish()).toBe(expected);
            expect(() => meter.push([new Float32Array(1)])).toThrow();
        }
    });
});
