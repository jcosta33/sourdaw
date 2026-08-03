import { describe, it, expect } from 'vitest';

import { renderEnvelope, applyEnvelope } from '../envelopes';

const SR = 100;

/**
 * Branch-focused specs for renderEnvelope covering the linear curve arm (attack,
 * decay, release), the rSamp Math.max(1,...) floor, the t >= 1 release clamp,
 * and the default-release fallback — none of which are exercised by the
 * existing dspProcessing.spec.ts (which only asserts on the exp curve).
 */

describe('renderEnvelope — linear curve', () => {
    it('attack is a straight ramp (not quadratic) under curve: linear', () => {
        // attack = 0.1s = 10 samples, no decay/sustain/release overlap.
        const env = renderEnvelope(
            0.1,
            { attack: 0.1, decay: 0, sustainLevel: 0.5, sustain: 0, release: 0, curve: 'linear' },
            SR
        );
        // Linear: t = i / aSamp, so sample 5 → 0.5 exactly. Exp would give 0.25.
        expect(env[5]).toBeCloseTo(0.5, 5);
        expect(env[9]).toBeCloseTo(0.9, 5);
    });

    it('decay under linear reaches sustainLevel via a straight line, not (1-t)^2', () => {
        // attack 0 → immediately in decay. decay = 0.1s = 10 samples, sustainLevel 0.4.
        const env = renderEnvelope(
            0.1,
            { attack: 0, decay: 0.1, sustainLevel: 0.4, sustain: 0, release: 0, curve: 'linear' },
            SR
        );
        // Linear decay formula: 1 - t*(1 - sLevel). At t=0.5 → 1 - 0.5*0.6 = 0.7.
        // Exp would give (1-0.5)^2 * 0.6 + 0.4 = 0.55.
        expect(env[5]).toBeCloseTo(0.7, 5);
    });

    it('linear release is sLevel*(1-t), not sLevel*(1-t)^2', () => {
        // attack 0, decay 0, sustain 0.05s=5 samples at level 0.8, release 0.1s=10 samples.
        const env = renderEnvelope(
            0.15,
            { attack: 0, decay: 0, sustainLevel: 0.8, sustain: 0.05, release: 0.1, curve: 'linear' },
            SR
        );
        // First 5 samples sustain at 0.8. Then release. At sample 10 (t=0.5 of release):
        // linear: 0.8 * (1 - 0.5) = 0.4. exp: 0.8 * 0.25 = 0.2.
        expect(env[10]).toBeCloseTo(0.4, 5);
    });

    it('exp and linear curves produce measurably different decay shapes', () => {
        const envExp = renderEnvelope(
            0.2,
            { attack: 0, decay: 0.1, sustainLevel: 0.4, sustain: 0, release: 0.1, curve: 'exp' },
            SR
        );
        const envLin = renderEnvelope(
            0.2,
            { attack: 0, decay: 0.1, sustainLevel: 0.4, sustain: 0, release: 0.1, curve: 'linear' },
            SR
        );
        // At t=0.5 of decay (sample 5), exp is above linear (exp curve holds value longer).
        // exp: 0.55, linear: 0.7. So exp < linear in decay's first half.
        const expMid = envExp[5]!;
        const linMid = envLin[5]!;
        expect(expMid).toBeLessThan(linMid);
    });
});

describe('renderEnvelope — rSamp Math.max(1, ...) floor', () => {
    it('zero-length release does not divide by zero (all values finite)', () => {
        // release explicitly 0 → r = max(0, 0) = 0 → rSamp = max(1, floor(0*100)) = 1. No NaN.
        const env = renderEnvelope(0.1, { attack: 0.02, decay: 0, sustainLevel: 0.6, sustain: 0.02, release: 0 }, SR);
        for (let i = 0; i < env.length; i++) {
            expect(Number.isFinite(env[i])).toBe(true);
        }
    });

    it('attack 0 with decay 0 jumps straight to sustain then release without NaN', () => {
        // aSamp=0 and dSamp=0 means the attack/decay branches are skipped (i < 0 is false),
        // so the sustain branch is entered immediately, then release. The rSamp floor
        // must prevent division-by-zero during release.
        const env = renderEnvelope(0.1, { attack: 0, decay: 0, sustainLevel: 0.5, sustain: 0.05, release: 0.05 }, SR);
        // First 5 samples are sustain at 0.5, then release decays from 0.5 to 0.
        expect(env[0]).toBeCloseTo(0.5, 5);
        for (let i = 0; i < env.length; i++) {
            expect(Number.isFinite(env[i])).toBe(true);
        }
    });
});

describe('renderEnvelope — t >= 1 release clamp', () => {
    it('clamps to exactly 0 once release completes, not a tiny negative residual', () => {
        // Total duration 0.2s=20 samples. attack 2, decay 0, sustain 3 (→ release starts at sample 5).
        // release 0.05s = 5 samples → by sample 10, t >= 1 → clamped to exactly 0.
        const env = renderEnvelope(
            0.2,
            { attack: 0.02, decay: 0, sustainLevel: 0.5, sustain: 0.03, release: 0.05 },
            SR
        );
        expect(env[15]).toBe(0);
        expect(env[19]).toBe(0);
    });
});

describe('renderEnvelope — default-release fallback', () => {
    it('derives release from durationSec - attack - decay - sustain when release is omitted', () => {
        // No release provided. durationSec=0.2, attack=0.02, decay=0.03, sustain=0.05.
        // Fallback release = 0.2 - 0.02 - 0.03 - 0.05 = 0.10s.
        const envExplicit = renderEnvelope(
            0.2,
            { attack: 0.02, decay: 0.03, sustainLevel: 0.5, sustain: 0.05, release: 0.1 },
            SR
        );
        const envFallback = renderEnvelope(0.2, { attack: 0.02, decay: 0.03, sustainLevel: 0.5, sustain: 0.05 }, SR);
        // Both should produce identical envelopes since fallback computes the same 0.1s.
        for (let i = 0; i < envExplicit.length; i++) {
            expect(envFallback[i]).toBeCloseTo(envExplicit[i]!, 6);
        }
    });

    it('default-release fallback clamps to 0 when duration is shorter than ADS (no NaN)', () => {
        // durationSec=0.05, attack=0.1, decay=0.1 → fallback release = 0.05 - 0.1 - 0.1 - 0 = -0.15.
        // Source clamps: r = Math.max(0, -0.15) = 0, so rSamp = max(1, floor(0*100)) = 1.
        // The buffer must be all finite.
        const env = renderEnvelope(0.05, { attack: 0.1, decay: 0.1, sustainLevel: 0.5, sustain: 0 }, SR);
        for (let i = 0; i < env.length; i++) {
            expect(Number.isFinite(env[i])).toBe(true);
        }
    });
});

describe('renderEnvelope — negative input clamping', () => {
    it('clamps negative attack/decay/sustain to 0 via Math.max(0, ...)', () => {
        const envNegative = renderEnvelope(
            0.15,
            { attack: -0.5, decay: -0.5, sustainLevel: 0.5, sustain: -0.5, release: 0.1 },
            SR
        );
        const envZero = renderEnvelope(0.15, { attack: 0, decay: 0, sustainLevel: 0.5, sustain: 0, release: 0.1 }, SR);
        for (let i = 0; i < envNegative.length; i++) {
            expect(envNegative[i]).toBeCloseTo(envZero[i]!, 6);
        }
    });
});

describe('renderEnvelope — sustain plateau is exactly sustainLevel', () => {
    it('holds a constant value across the full sustain region', () => {
        // attack 2, decay 3, sustain 10 → samples 5..14 are sustain at level 0.6.
        const env = renderEnvelope(
            0.2,
            { attack: 0.02, decay: 0.03, sustainLevel: 0.6, sustain: 0.1, release: 0.05 },
            SR
        );
        for (let i = 5; i < 15; i++) {
            expect(env[i]).toBeCloseTo(0.6, 5);
        }
    });

    it('defaults sustainLevel to 0 when omitted', () => {
        const env = renderEnvelope(0.1, { attack: 0.02, decay: 0, sustain: 0.02, release: 0.06 }, SR);
        // sustainLevel ?? 0 → plateau at 0 during sustain region (samples 2..3).
        expect(env[2]).toBe(0);
        expect(env[3]).toBe(0);
    });
});

describe('applyEnvelope — boundary length interactions', () => {
    it('preserves buffer values when envelope is all-ones and same length', () => {
        const buf = new Float32Array([0.1, 0.2, 0.3, 0.4]);
        const env = new Float32Array([1, 1, 1, 1]);
        applyEnvelope(buf, env);
        for (let i = 0; i < 4; i++) {
            expect(buf[i]).toBeCloseTo([0.1, 0.2, 0.3, 0.4][i]!, 5);
        }
    });

    it('does not touch buffer entries when envelope is longer than buffer', () => {
        const buf = new Float32Array([0.5, 0.5]);
        const env = new Float32Array([0.5, 0.5, 1, 1, 1]);
        applyEnvelope(buf, env);
        // len = min(2, 5) = 2, zeroing loop (i = 2; i < 2) never runs.
        expect(buf[0]).toBeCloseTo(0.25, 5);
        expect(buf[1]).toBeCloseTo(0.25, 5);
    });

    it('zeros all entries when envelope is empty', () => {
        const buf = new Float32Array([0.7, 0.7, 0.7]);
        const env = new Float32Array(0);
        applyEnvelope(buf, env);
        expect(buf[0]).toBe(0);
        expect(buf[1]).toBe(0);
        expect(buf[2]).toBe(0);
    });
});
