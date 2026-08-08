import { describe, expect, it } from 'vitest';

import { biquad, biquadSweep } from '../filters';

const SAMPLE_RATE = 44100;

/**
 * Generate a single-sample-precise sine at `freq` into a fresh Float32Array.
 */
function sine(length: number, freq: number, sampleRate = SAMPLE_RATE): Float32Array {
    const buf = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
        buf[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
    return buf;
}

/**
 * RMS magnitude of a buffer slice — proportional to signal power. Used to
 * compare energy before/after filtering at a target frequency.
 */
function rms(buf: Float32Array, from = 0, to = buf.length): number {
    let sum = 0;
    let count = 0;
    for (let i = from; i < to; i += 1) {
        sum += buf[i]! * buf[i]!;
        count += 1;
    }
    return Math.sqrt(sum / Math.max(1, count));
}

describe('biquad', () => {
    it('lowpass attenuates high-frequency energy more than low-frequency energy', () => {
        const low = sine(4096, 100);
        const high = sine(4096, 10000);

        biquad(low, { type: 'lowpass', freq: 500, q: 0.707 });
        biquad(high, { type: 'lowpass', freq: 500, q: 0.707 });

        // Discard the first 512 samples (filter transient / state settling).
        const lowRms = rms(low, 512);
        const highRms = rms(high, 512);

        expect(lowRms).toBeGreaterThan(0);
        // A 10 kHz signal through a 500 Hz lowpass is deeply attenuated.
        expect(highRms).toBeLessThan(lowRms * 0.1);
    });

    it('highpass attenuates low-frequency energy more than high-frequency energy', () => {
        const low = sine(4096, 80);
        const high = sine(4096, 8000);

        biquad(low, { type: 'highpass', freq: 1000, q: 0.707 });
        biquad(high, { type: 'highpass', freq: 1000, q: 0.707 });

        const lowRms = rms(low, 512);
        const highRms = rms(high, 512);

        expect(highRms).toBeGreaterThan(0);
        // An 80 Hz signal through a 1 kHz highpass is deeply attenuated.
        expect(lowRms).toBeLessThan(highRms * 0.1);
    });

    it('bandpass passes the centre frequency and attenuates far from it', () => {
        const centre = sine(4096, 1000);
        const farLow = sine(4096, 50);

        biquad(centre, { type: 'bandpass', freq: 1000, q: 1 });
        biquad(farLow, { type: 'bandpass', freq: 1000, q: 1 });

        const centreRms = rms(centre, 512);
        const farLowRms = rms(farLow, 512);

        expect(centreRms).toBeGreaterThan(farLowRms * 5);
    });

    it('peaking boosts the target frequency', () => {
        const atTarget = sine(4096, 2000);
        const farFromTarget = sine(4096, 200);

        biquad(atTarget, { type: 'peaking', freq: 2000, q: 1, gainDb: 12 });
        biquad(farFromTarget, { type: 'peaking', freq: 2000, q: 1, gainDb: 12 });

        const atTargetRms = rms(atTarget, 512);
        const farRms = rms(farFromTarget, 512);

        // +12 dB is ~4× amplitude. The boosted band should be much louder than
        // the band far from the peak.
        expect(atTargetRms).toBeGreaterThan(farRms * 3);
    });

    it('lowshelf boosts low frequencies', () => {
        const low = sine(4096, 80);
        const high = sine(4096, 8000);

        biquad(low, { type: 'lowshelf', freq: 500, gainDb: 12 });
        biquad(high, { type: 'lowshelf', freq: 500, gainDb: 12 });

        const lowRms = rms(low, 512);
        const highRms = rms(high, 512);

        // Low band is boosted, high band is approximately unchanged.
        expect(lowRms).toBeGreaterThan(highRms * 2);
    });

    it('highshelf boosts high frequencies', () => {
        const low = sine(4096, 80);
        const high = sine(4096, 8000);

        biquad(low, { type: 'highshelf', freq: 2000, gainDb: 12 });
        biquad(high, { type: 'highshelf', freq: 2000, gainDb: 12 });

        const lowRms = rms(low, 512);
        const highRms = rms(high, 512);

        expect(highRms).toBeGreaterThan(lowRms * 2);
    });

    it('mutates the buffer in place (same reference, different values)', () => {
        const buf = sine(256, 440);
        const ref = buf;
        const originalSample = buf[100];

        biquad(buf, { type: 'lowpass', freq: 2000 });

        // Same array reference.
        expect(buf).toBe(ref);
        // The filter changed the sample at index 100.
        expect(buf[100]).not.toBeCloseTo(originalSample!, 5);
    });

    it('uses the default sample rate when none is passed', () => {
        const buf = sine(1024, 440);
        // Should not throw and should attenuate.
        biquad(buf, { type: 'lowpass', freq: 100, q: 0.707 });
        expect(rms(buf, 128)).toBeLessThan(0.2);
    });
});

describe('biquadSweep', () => {
    it('sweeps the cutoff from freqStart to freqEnd, attenuating low freqs at the end', () => {
        // A 100 Hz signal. If the sweep starts at 200 Hz lowpass and ends at
        // 50 Hz lowpass, the tail should be heavily attenuated.
        const buf = sine(4096, 100);

        biquadSweep(buf, { type: 'lowpass', freqStart: 500, freqEnd: 50 });

        const headRms = rms(buf, 100, 600);
        const tailRms = rms(buf, buf.length - 600);

        // As the cutoff sweeps down past 100 Hz, the tail must lose energy.
        expect(tailRms).toBeLessThan(headRms);
    });

    it('handles a single-sample buffer without dividing by zero', () => {
        const buf = new Float32Array([0.5]);

        // len === 1 → t = 1, no NaN from i/(len-1).
        expect(() => biquadSweep(buf, { type: 'lowpass', freqStart: 100, freqEnd: 200 })).not.toThrow();
        expect(Number.isFinite(buf[0])).toBe(true);
    });

    it('mutates the buffer in place', () => {
        const buf = sine(512, 440);
        const ref = buf;

        biquadSweep(buf, { type: 'highpass', freqStart: 100, freqEnd: 5000 });

        expect(buf).toBe(ref);
    });
});
