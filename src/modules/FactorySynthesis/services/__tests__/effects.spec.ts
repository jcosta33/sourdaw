import { describe, it, expect } from 'vitest';

import { bitcrush, feedbackDelay } from '../effects';

const SR = 44100;

describe('bitcrush', () => {
    it('quantizes a full-scale sample to the requested bit depth', () => {
        // 2 bits → steps = 2^(2-1) = 2. round(0.5 * 2) / 2 = 0.5.
        const buf = new Float32Array([0.5]);
        bitcrush(buf, 2);
        expect(buf[0]).toBe(0.5);
    });

    it('snaps a mid-range sample to the nearest quantization step', () => {
        // 4 bits → steps = 2^3 = 8. round(0.3 * 8) / 8 = round(2.4)/8 = 2/8 = 0.25.
        const buf = new Float32Array([0.3]);
        bitcrush(buf, 4);
        expect(buf[0]).toBeCloseTo(0.25, 10);
    });

    it('reduces resolution: lower bits produce fewer distinct levels', () => {
        const input = new Float32Array(100);
        for (let i = 0; i < input.length; i++) {
            input[i] = (i / input.length) * 2 - 1; // ramp -1..+1
        }
        const low = new Float32Array(input);
        const high = new Float32Array(input);
        bitcrush(low, 2);
        bitcrush(high, 16);
        const distinctLow = new Set(low).size;
        const distinctHigh = new Set(high).size;
        expect(distinctLow).toBeLessThan(distinctHigh);
    });

    it('holds (sample-and-holds) values when sampleRateReduction > 1', () => {
        const buf = new Float32Array([0.1, 0.2, 0.3, 0.4]);
        bitcrush(buf, 16, 2);
        // With reduction=2, the first computed value is held for 2 samples.
        // Sample 0: round(0.1 * 2^15) / 2^15 ≈ 0.1. Sample 1 held = sample 0.
        expect(buf[1]).toBe(buf[0]);
        // Sample 2 recomputes from buf[2]=0.3; sample 3 held = sample 2.
        expect(buf[3]).toBe(buf[2]);
        // The held pairs differ from each other.
        expect(buf[0]).not.toBe(buf[2]);
    });

    it('produces finite output across a full-scale ramp', () => {
        const buf = new Float32Array(256);
        for (let i = 0; i < buf.length; i++) {
            buf[i] = Math.sin((i / buf.length) * Math.PI * 2);
        }
        bitcrush(buf, 6);
        for (let i = 0; i < buf.length; i++) {
            expect(Number.isFinite(buf[i])).toBe(true);
        }
    });
});

describe('feedbackDelay', () => {
    it('passes dry signal through when wetMix is 0', () => {
        const buf = new Float32Array([0.5, -0.3, 0.8, 0.1]);
        const original = new Float32Array(buf);
        feedbackDelay(buf, 0.001, 0.5, 0, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(buf[i]).toBeCloseTo(original[i]!, 6);
        }
    });

    it('adds no wet signal before the delay line has filled (initial delay samples)', () => {
        const delaySec = 0.001; // ~44 samples at 44100
        const delaySamples = Math.max(1, Math.floor(delaySec * SR));
        const buf = new Float32Array(delaySamples).fill(0.8);
        feedbackDelay(buf, delaySec, 0.5, 1.0, SR);
        // Within the first delay-window the line reads 0, so output = input*0 + 0*1 = 0.
        for (let i = 0; i < buf.length; i++) {
            expect(buf[i]).toBe(0);
        }
    });

    it('blends wet and dry according to wetMix', () => {
        // Delay of exactly 1 sample: wet output at sample 1 reads the delayed
        // line which holds the previous input written at sample 0.
        const buf = new Float32Array([1.0, 0.0]);
        feedbackDelay(buf, 1 / SR, 0.0, 0.5, SR);
        // Sample 0: input=1, delayed=0 → 1*(1-0.5) + 0*0.5 = 0.5.
        expect(buf[0]).toBeCloseTo(0.5, 6);
        // Sample 1: input=0, delayed=line value=1 (written at sample 0 with feedback 0) → 0*0.5 + 1*0.5 = 0.5.
        expect(buf[1]).toBeCloseTo(0.5, 6);
    });

    it('feeds back the delayed signal scaled by feedback gain', () => {
        // Delay = 1 sample, feedback = 1, wetMix = 1, input impulse at sample 0.
        const buf = new Float32Array(8);
        buf[0] = 1.0;
        feedbackDelay(buf, 1 / SR, 1.0, 1.0, SR);
        // With feedback=1 and wet=1, the impulse recirculates indefinitely:
        // every sample after the first should equal the previous delayed value.
        for (let i = 1; i < buf.length; i++) {
            expect(buf[i]).toBeCloseTo(1.0, 5);
        }
    });

    it('decays the feedback signal when feedback < 1', () => {
        const buf = new Float32Array(6);
        buf[0] = 1.0;
        feedbackDelay(buf, 1 / SR, 0.5, 1.0, SR);
        // Sample 1: delayed=1 → output=1, line written=0+1*0.5=0.5.
        expect(buf[1]).toBeCloseTo(1.0, 5);
        // Sample 2: delayed=0.5 → output=0.5.
        expect(buf[2]).toBeCloseTo(0.5, 5);
        // Sample 3: delayed=0.25 → output=0.25.
        expect(buf[3]).toBeCloseTo(0.25, 5);
    });

    it('clamps a sub-sample delay to at least 1 sample', () => {
        // delaySec so small that floor(delaySec*SR) = 0 → max(1, 0) = 1 sample.
        const buf = new Float32Array([1.0, 0.0]);
        feedbackDelay(buf, 1e-9, 0.0, 0.5, SR);
        // Behaves like a 1-sample delay (no throw, finite output).
        expect(Number.isFinite(buf[0])).toBe(true);
        expect(Number.isFinite(buf[1])).toBe(true);
    });

    it('produces finite output for a sustained signal', () => {
        const buf = new Float32Array(SR * 0.05);
        for (let i = 0; i < buf.length; i++) {
            buf[i] = Math.sin((2 * Math.PI * 440 * i) / SR);
        }
        feedbackDelay(buf, 0.01, 0.4, 0.3, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(Number.isFinite(buf[i])).toBe(true);
        }
    });
});
