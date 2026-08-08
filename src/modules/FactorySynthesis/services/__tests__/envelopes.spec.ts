import { describe, expect, it } from 'vitest';

import { applyEnvelope, renderEnvelope } from '../envelopes';

describe('renderEnvelope', () => {
    it('ramps linearly from 0 to 1 during the attack phase', () => {
        // 100-sample attack at 1 sample/ms → 100 samples total.
        const env = renderEnvelope(0.1, { attack: 0.1, curve: 'linear' }, 1000);

        expect(env.length).toBe(100);
        // At the start of attack, level is ~0.
        expect(env[0]).toBeCloseTo(0, 5);
        // Mid-attack, level is ~0.5.
        expect(env[50]).toBeCloseTo(0.5, 5);
        // Near the end of attack, level approaches 1 (i/100 at i=99 → 0.99).
        expect(env[99]).toBeCloseTo(0.99, 5);
    });

    it('decays from 1 to sustainLevel with an exponential curve', () => {
        // 10-sample attack, 100-sample decay to 0.3 sustain.
        const env = renderEnvelope(0.11, { attack: 0.01, decay: 0.1, sustainLevel: 0.3, curve: 'exp' }, 1000);

        // Start of decay (sample 10) should be ~1.
        expect(env[10]).toBeCloseTo(1, 1);
        // End of decay (sample 109) should approach sustainLevel 0.3.
        // Exponential: (1-t)^2 * (1-0.3) + 0.3. At t=0.99: ~0.3034.
        expect(env[109]).toBeCloseTo(0.3, 1);
        // Decay must end above sustainLevel, not below it.
        expect(env[109]).toBeGreaterThan(0.29);
    });

    it('decays from 1 to sustainLevel with a linear curve', () => {
        const env = renderEnvelope(0.11, { attack: 0.01, decay: 0.1, sustainLevel: 0.3, curve: 'linear' }, 1000);

        // Linear decay: 1 - t * (1 - 0.3). At t=0.5 (sample 60): 1 - 0.5*0.7 = 0.65.
        expect(env[60]).toBeCloseTo(0.65, 1);
    });

    it('holds the sustain level during the sustain phase', () => {
        const env = renderEnvelope(0.21, { attack: 0.01, decay: 0.1, sustain: 0.1, sustainLevel: 0.4 }, 1000);

        // Sustain phase is samples 110–209.
        for (let i = 110; i < 210; i += 20) {
            expect(env[i]).toBeCloseTo(0.4, 5);
        }
    });

    it('releases to 0 exponentially after the sustain phase', () => {
        // durationSec must cover all phases: a(10) + d(100) + s(100) + r(100) = 310 samples.
        const env = renderEnvelope(
            0.31,
            { attack: 0.01, decay: 0.1, sustain: 0.1, sustainLevel: 0.5, release: 0.1, curve: 'exp' },
            1000
        );

        // Release phase is samples 210–309 (release=0.1s = 100 samples).
        // Start of release should be ~0.5 (sustainLevel).
        expect(env[210]).toBeCloseTo(0.5, 1);
        // Mid-release: sLevel * (1-t)^2. At t=0.5: 0.5 * 0.25 = 0.125.
        expect(env[260]).toBeCloseTo(0.125, 1);
        // End of release: t >= 1 → 0.
        expect(env[309]).toBeCloseTo(0, 2);
    });

    it('defaults release to the remaining time when not specified', () => {
        // durationSec=0.2, attack=0.05, decay=0.05, sustain=0.05 → release defaults to
        // 0.2 - 0.05 - 0.05 - 0.05 = 0.05s = 50 samples at rate 1000.
        const env = renderEnvelope(0.2, { attack: 0.05, decay: 0.05, sustain: 0.05, sustainLevel: 0.6 }, 1000);

        // Sustain phase: samples 100–149 should hold 0.6.
        expect(env[120]).toBeCloseTo(0.6, 5);
        // Release starts at 150, should ramp down to ~0.
        expect(env[150]).toBeCloseTo(0.6, 1);
        expect(env[199]).toBeCloseTo(0, 2);
    });

    it('produces at least one sample even for zero duration', () => {
        const env = renderEnvelope(0, {});

        expect(env.length).toBe(1);
    });

    it('clamps negative phase lengths to zero', () => {
        // Negative attack/decay/sustain should be treated as 0, not NaN.
        const env = renderEnvelope(
            0.05,
            { attack: -1, decay: -1, sustain: -1, release: 0.05, sustainLevel: 0.5 },
            1000
        );

        expect(env.length).toBe(50);
        expect(Number.isFinite(env[0])).toBe(true);
        expect(Number.isFinite(env[49])).toBe(true);
    });
});

describe('applyEnvelope', () => {
    it('multiplies the buffer element-wise by the envelope', () => {
        const buf = new Float32Array([1, 1, 1, 1]);
        const env = new Float32Array([0, 0.5, 1, 0.5]);

        applyEnvelope(buf, env);

        expect(Array.from(buf)).toEqual([0, 0.5, 1, 0.5]);
    });

    it('zeroes the buffer beyond the envelope length', () => {
        const buf = new Float32Array([1, 1, 1, 1]);
        const env = new Float32Array([1, 1]);

        applyEnvelope(buf, env);

        // First two samples multiplied by 1, remaining zeroed.
        expect(Array.from(buf)).toEqual([1, 1, 0, 0]);
    });

    it('stops at the buffer length when the envelope is longer', () => {
        const buf = new Float32Array([2, 2]);
        const env = new Float32Array([1, 1, 1, 1]);

        applyEnvelope(buf, env);

        expect(Array.from(buf)).toEqual([2, 2]);
    });
});
