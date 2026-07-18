import { describe, it, expect } from 'vitest';

import { renderEnvelope, applyEnvelope } from '../envelopes';
import { biquad, biquadSweep } from '../filters';

const SR = 48000;

describe('renderEnvelope', () => {
    it('produces correct length', () => {
        const env = renderEnvelope(
            0.5,
            { attack: 0.01, decay: 0.1, sustainLevel: 0.7, sustain: 0.2, release: 0.19 },
            SR
        );
        expect(env.length).toBe(Math.ceil(0.5 * SR));
    });

    it('starts at 0', () => {
        const env = renderEnvelope(0.5, { attack: 0.1, decay: 0.1, sustainLevel: 0.5, sustain: 0.1, release: 0.2 }, SR);
        expect(env[0]).toBeCloseTo(0, 5);
    });

    it('reaches peak during attack', () => {
        const env = renderEnvelope(0.5, { attack: 0.1, decay: 0.1, sustainLevel: 0.5, sustain: 0.1, release: 0.2 }, SR);
        const attack_end = Math.floor(0.1 * SR);
        expect(env[attack_end]).toBeGreaterThan(0.9);
    });

    it('reaches sustain level after decay', () => {
        const env = renderEnvelope(
            0.5,
            { attack: 0.05, decay: 0.1, sustainLevel: 0.6, sustain: 0.2, release: 0.15 },
            SR
        );
        const sustain_start = Math.floor((0.05 + 0.1) * SR);
        expect(env[sustain_start]).toBeCloseTo(0.6, 1);
    });

    it('ends at 0 after release', () => {
        const env = renderEnvelope(
            0.5,
            { attack: 0.01, decay: 0.05, sustainLevel: 0.7, sustain: 0.1, release: 0.34 },
            SR
        );
        expect(env[env.length - 1]).toBeCloseTo(0, 2);
    });

    it('all values are 0-1', () => {
        const env = renderEnvelope(1.0, { attack: 0.1, decay: 0.2, sustainLevel: 0.5, sustain: 0.3, release: 0.4 }, SR);
        for (let i = 0; i < env.length; i++) {
            expect(env[i]).toBeGreaterThanOrEqual(0);
            expect(env[i]).toBeLessThanOrEqual(1.001);
        }
    });
});

describe('applyEnvelope', () => {
    it('multiplies buffer by envelope', () => {
        const buf = new Float32Array([1, 1, 1, 1]);
        const env = new Float32Array([0, 0.5, 1, 0.5]);
        applyEnvelope(buf, env);
        expect(Array.from(buf)).toEqual([0, 0.5, 1, 0.5]);
    });

    it('zeros buffer beyond envelope length', () => {
        const buf = new Float32Array([1, 1, 1, 1]);
        const env = new Float32Array([1, 0.5]);
        applyEnvelope(buf, env);
        expect(buf[2]).toBe(0);
        expect(buf[3]).toBe(0);
    });
});

describe('biquad', () => {
    it('lowpass reduces high frequency content', () => {
        const buf = new Float32Array(SR * 0.01);
        for (let i = 0; i < buf.length; i++) {
            buf[i] = Math.sin((2 * Math.PI * 5000 * i) / SR);
        }
        const energy_before = buf.reduce((s, v) => s + v * v, 0);
        biquad(buf, { type: 'lowpass', freq: 200, q: 0.707 }, SR);
        const energy_after = buf.reduce((s, v) => s + v * v, 0);
        expect(energy_after).toBeLessThan(energy_before);
    });

    it('highpass reduces low frequency content', () => {
        const buf = new Float32Array(SR * 0.01);
        for (let i = 0; i < buf.length; i++) {
            buf[i] = Math.sin((2 * Math.PI * 50 * i) / SR);
        }
        const energy_before = buf.reduce((s, v) => s + v * v, 0);
        biquad(buf, { type: 'highpass', freq: 2000, q: 0.707 }, SR);
        const energy_after = buf.reduce((s, v) => s + v * v, 0);
        expect(energy_after).toBeLessThan(energy_before);
    });

    it('produces finite output', () => {
        const buf = new Float32Array(100).fill(0.5);
        biquad(buf, { type: 'peaking', freq: 1000, q: 2, gainDb: 6 }, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(Number.isFinite(buf[i])).toBe(true);
        }
    });
});

describe('biquadSweep', () => {
    it('produces finite output across frequency range', () => {
        const buf = new Float32Array(SR * 0.05).fill(0.5);
        biquadSweep(buf, { type: 'lowpass', freqStart: 100, freqEnd: 5000, q: 1 }, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(Number.isFinite(buf[i])).toBe(true);
        }
    });
});
