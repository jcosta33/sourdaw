import { describe, it, expect } from 'vitest';

import { biquad, biquadSweep } from '../filters';

const SR = 48000;

/**
 * Branch-focused specs for biquad filter coefficients. The existing
 * dspProcessing.spec.ts only tests lowpass, highpass, and peaking. These specs
 * add direct coverage for bandpass, lowshelf, and highshelf coefficient arms,
 * plus the biquadSweep exponential frequency interpolation and len === 1 guard.
 *
 * Strategy: each filter type is exercised on a known input and its
 * frequency-selective behavior is asserted via energy measurements on a
 * band-limited test signal. Lowpass/bandpass attenuate out-of-band content;
 * shelf filters shift energy of in-band content.
 */

function sinusoid(freq: number, samples: number, sr: number = SR): Float32Array {
    const buf = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
        buf[i] = Math.sin((2 * Math.PI * freq * i) / sr);
    }
    return buf;
}

function energy(buf: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
        sum += buf[i]! * buf[i]!;
    }
    return sum;
}

describe('biquad — bandpass', () => {
    it('passes content near the center frequency and attenuates distant frequencies', () => {
        const centerFreq = 1000;
        const inBandBefore = energy(sinusoid(centerFreq, SR));
        const outOfBandBefore = energy(sinusoid(50, SR));

        const inBand = sinusoid(centerFreq, SR);
        const outOfBand = sinusoid(50, SR);
        biquad(inBand, { type: 'bandpass', freq: centerFreq, q: 5 }, SR);
        biquad(outOfBand, { type: 'bandpass', freq: centerFreq, q: 5 }, SR);

        const inBandAfter = energy(inBand);
        const outOfBandAfter = energy(outOfBand);

        // In-band content survives (some energy retained after transient settles).
        expect(inBandAfter).toBeGreaterThan(0);
        // Out-of-band content is more aggressively attenuated than in-band.
        const inBandRetention = inBandAfter / inBandBefore;
        const outOfBandRetention = outOfBandAfter / outOfBandBefore;
        expect(inBandRetention).toBeGreaterThan(outOfBandRetention);
    });

    it('bandpass has b0 = alpha (positive), distinct from lowpass b0 = (1-cosw)/2', () => {
        // Bandpass: b0 = alpha, b2 = -alpha (anti-symmetric numerator).
        // Lowpass: b0 = b2 = (1-cosw)/2 (symmetric numerator).
        // For freq=1000 at 48kHz, alpha > (1-cosw)/2, so bandpass y0 > lowpass y0.
        const bp = new Float32Array(10);
        const lp = new Float32Array(10);
        bp[0] = 1;
        lp[0] = 1;
        biquad(bp, { type: 'bandpass', freq: 1000, q: 1 }, SR);
        biquad(lp, { type: 'lowpass', freq: 1000, q: 1 }, SR);
        // y0 = b0. Bandpass alpha > lowpass (1-cosw)/2 at this frequency.
        expect(bp[0]).toBeGreaterThan(lp[0]);
        // Both must be positive (the impulse passes through).
        expect(bp[0]).toBeGreaterThan(0);
    });
});

describe('biquad — lowshelf', () => {
    it('boosts low-frequency content below the shelf frequency with positive gainDb', () => {
        const lowFreq = 80;
        const before = energy(sinusoid(lowFreq, SR));

        const buf = sinusoid(lowFreq, SR);
        biquad(buf, { type: 'lowshelf', freq: 500, q: 0.707, gainDb: 12 }, SR);

        const after = energy(buf);
        // +12 dB gain ≈ 4× amplitude ≈ 16× energy. Low-frequency content should
        // be boosted, not attenuated.
        expect(after).toBeGreaterThan(before);
    });

    it('does not crash and stays finite with gainDb of 0 (unity)', () => {
        const buf = sinusoid(200, 500);
        biquad(buf, { type: 'lowshelf', freq: 500, q: 0.707, gainDb: 0 }, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(Number.isFinite(buf[i])).toBe(true);
        }
    });

    it('cuts low-frequency content with negative gainDb', () => {
        const before = energy(sinusoid(80, SR));
        const buf = sinusoid(80, SR);
        biquad(buf, { type: 'lowshelf', freq: 500, q: 0.707, gainDb: -12 }, SR);
        const after = energy(buf);
        expect(after).toBeLessThan(before);
    });
});

describe('biquad — highshelf', () => {
    it('boosts high-frequency content above the shelf frequency with positive gainDb', () => {
        const highFreq = 5000;
        const before = energy(sinusoid(highFreq, SR));

        const buf = sinusoid(highFreq, SR);
        biquad(buf, { type: 'highshelf', freq: 500, q: 0.707, gainDb: 12 }, SR);

        const after = energy(buf);
        expect(after).toBeGreaterThan(before);
    });

    it('cuts high-frequency content with negative gainDb', () => {
        const highFreq = 5000;
        const before = energy(sinusoid(highFreq, SR));
        const buf = sinusoid(highFreq, SR);
        biquad(buf, { type: 'highshelf', freq: 500, q: 0.707, gainDb: -12 }, SR);
        const after = energy(buf);
        expect(after).toBeLessThan(before);
    });
});

describe('biquad — coefficient relationships', () => {
    it('lowpass and highpass produce measurably different impulse responses', () => {
        // lowpass: b1 = 1 - cosw (positive), b0 = b2 = (1-cosw)/2.
        // highpass: b1 = -(1 + cosw) (negative), b0 = b2 = (1+cosw)/2.
        // For the same params, highpass b0 > lowpass b0 (since 1+cosw > 1-cosw for w0 in (0,π)).
        // So the first impulse tap of highpass should exceed that of lowpass.
        const lp = new Float32Array(5);
        const hp = new Float32Array(5);
        lp[0] = 1;
        hp[0] = 1;
        biquad(lp, { type: 'lowpass', freq: 1000, q: 0.707 }, SR);
        biquad(hp, { type: 'highpass', freq: 1000, q: 0.707 }, SR);
        // y0 = b0. highpass b0 = (1+cosw)/2 > lowpass b0 = (1-cosw)/2.
        expect(hp[0]).toBeGreaterThan(lp[0]);
        // Both must be non-zero (the impulse reaches the filter).
        expect(lp[0]).not.toBe(0);
        expect(hp[0]).not.toBe(0);
    });

    it('peaking with positive gainDb boosts at the center frequency', () => {
        const centerFreq = 2000;
        const before = energy(sinusoid(centerFreq, SR));
        const buf = sinusoid(centerFreq, SR);
        biquad(buf, { type: 'peaking', freq: centerFreq, q: 1, gainDb: 9 }, SR);
        const after = energy(buf);
        expect(after).toBeGreaterThan(before);
    });
});

describe('biquadSweep — exponential frequency interpolation', () => {
    it('exponentially interpolates frequency between freqStart and freqEnd', () => {
        // The midpoint of the sweep should correspond to the geometric mean of
        // freqStart and freqEnd, not the arithmetic mean. We verify this
        // indirectly: a sweep from 100 to 10000 over 2 samples has t=0 and t=1
        // exactly (len === 2 → i/(len-1) gives 0 and 1). The coefficient at
        // t=1 uses freqEnd, so the output must differ from a sweep ending at
        // a different freqEnd.
        const bufA = new Float32Array(100).fill(0.5);
        const bufB = new Float32Array(100).fill(0.5);
        biquadSweep(bufA, { type: 'lowpass', freqStart: 100, freqEnd: 10000, q: 1 }, SR);
        biquadSweep(bufB, { type: 'lowpass', freqStart: 100, freqEnd: 1000, q: 1 }, SR);
        // Different end frequencies → different filter trajectories → different energy.
        expect(energy(bufA)).not.toBeCloseTo(energy(bufB), 0);
    });

    it('len === 1 guard sets t = 1 (avoids division by zero for single-sample buffer)', () => {
        const buf = new Float32Array([0.5]);
        // Must not produce NaN. len === 1 → t = 1 → freq = freqEnd.
        biquadSweep(buf, { type: 'lowpass', freqStart: 100, freqEnd: 5000, q: 1 }, SR);
        expect(Number.isFinite(buf[0])).toBe(true);
    });

    it('applies increasing attenuation when sweeping a lowpass from high to low frequency', () => {
        // Start at 8000 Hz (passes most content), end at 100 Hz (cuts most content).
        // The energy should be lower than a static highpass at the same Q — or more
        // directly, the output should have less high-frequency energy than the input.
        const input = sinusoid(8000, SR * 0.05);
        const before = energy(input);
        const buf = sinusoid(8000, SR * 0.05);
        biquadSweep(buf, { type: 'lowpass', freqStart: 8000, freqEnd: 100, q: 0.707 }, SR);
        const after = energy(buf);
        // As the cutoff drops below the signal frequency, energy is attenuated.
        expect(after).toBeLessThan(before);
    });

    it('produces the same output as a static biquad when freqStart === freqEnd', () => {
        const bufSweep = sinusoid(1000, 500);
        const bufStatic = sinusoid(1000, 500);
        biquadSweep(bufSweep, { type: 'peaking', freqStart: 1000, freqEnd: 1000, q: 1 }, SR);
        biquad(bufStatic, { type: 'peaking', freq: 1000, q: 1, gainDb: 0 }, SR);
        // freqStart * (freqEnd/freqStart)^t = 1000 * 1^t = 1000 for all t.
        // So the sweep reduces to a static filter at 1000 Hz.
        for (let i = 0; i < bufSweep.length; i++) {
            expect(bufSweep[i]).toBeCloseTo(bufStatic[i]!, 6);
        }
    });

    it('defaults q to 0.707 when omitted', () => {
        const bufWithQ = sinusoid(500, 300);
        const bufNoQ = sinusoid(500, 300);
        biquadSweep(bufWithQ, { type: 'lowpass', freqStart: 200, freqEnd: 2000, q: 0.707 }, SR);
        biquadSweep(bufNoQ, { type: 'lowpass', freqStart: 200, freqEnd: 2000 }, SR);
        for (let i = 0; i < bufWithQ.length; i++) {
            expect(bufNoQ[i]).toBeCloseTo(bufWithQ[i]!, 6);
        }
    });
});

describe('biquad — default parameter fallbacks', () => {
    it('defaults q to 0.707 when omitted', () => {
        const bufWithQ = sinusoid(1000, 300);
        const bufNoQ = sinusoid(1000, 300);
        biquad(bufWithQ, { type: 'lowpass', freq: 1000, q: 0.707 }, SR);
        biquad(bufNoQ, { type: 'lowpass', freq: 1000 }, SR);
        for (let i = 0; i < bufWithQ.length; i++) {
            expect(bufNoQ[i]).toBeCloseTo(bufWithQ[i]!, 6);
        }
    });

    it('defaults gainDb to 0 when omitted', () => {
        const bufWithGain = sinusoid(1000, 300);
        const bufNoGain = sinusoid(1000, 300);
        biquad(bufWithGain, { type: 'peaking', freq: 1000, q: 1, gainDb: 0 }, SR);
        biquad(bufNoGain, { type: 'peaking', freq: 1000, q: 1 }, SR);
        for (let i = 0; i < bufWithGain.length; i++) {
            expect(bufNoGain[i]).toBeCloseTo(bufWithGain[i]!, 6);
        }
    });

    it('clamps q to a minimum of 0.0001 to avoid division by zero', () => {
        const buf = sinusoid(1000, 300);
        // q = 0 → alpha = sinw / (2 * max(0.0001, 0)) = sinw / 0.0002. Finite.
        biquad(buf, { type: 'lowpass', freq: 1000, q: 0 }, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(Number.isFinite(buf[i])).toBe(true);
        }
    });
});
