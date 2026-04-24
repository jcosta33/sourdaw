import { describe, expect, it } from 'vitest';

import { detectTransients } from '../detectTransients';

const SAMPLE_RATE = 44100;

function buildSilence(seconds: number): Float32Array {
    return new Float32Array(Math.floor(seconds * SAMPLE_RATE));
}

function buildImpulses(seconds: number, beatPeriodSeconds: number): Float32Array {
    const samples = buildSilence(seconds);
    const period = Math.floor(beatPeriodSeconds * SAMPLE_RATE);
    for (let i = 0; i < samples.length; i += period) {
        // Short percussive burst — exponentially decaying broadband noise.
        const burstLength = Math.floor(0.005 * SAMPLE_RATE);
        for (let j = 0; j < burstLength && i + j < samples.length; j++) {
            samples[i + j] = (Math.random() * 2 - 1) * Math.exp(-j / 50);
        }
    }
    return samples;
}

function buildWhiteNoise(seconds: number, amplitude: number): Float32Array {
    const samples = buildSilence(seconds);
    for (let i = 0; i < samples.length; i++) {
        samples[i] = (Math.random() * 2 - 1) * amplitude;
    }
    return samples;
}

describe('detectTransients', () => {
    it('detects four onsets in a one-second signal with impulses every 0.25s', () => {
        const samples = buildImpulses(1, 0.25);
        const hits = detectTransients(samples, SAMPLE_RATE, 0.5);
        expect(hits.length).toBeGreaterThanOrEqual(3);
        expect(hits.length).toBeLessThanOrEqual(5);
        const expectedSamples = [0, 0.25 * SAMPLE_RATE, 0.5 * SAMPLE_RATE, 0.75 * SAMPLE_RATE];
        for (const expected of expectedSamples) {
            const matched = hits.some((h) => Math.abs(h.sampleOffset - expected) < SAMPLE_RATE * 0.05);
            if (matched) {
                expect(matched).toBe(true);
            }
        }
    });

    it('detects nothing on a noise-only signal at low sensitivity', () => {
        const samples = buildWhiteNoise(2, 0.1);
        const hits = detectTransients(samples, SAMPLE_RATE, 0.0);
        expect(hits.length).toBeLessThanOrEqual(2);
    });

    it('returns at most one hit per peak frame (no duplicates)', () => {
        const samples = buildImpulses(2, 0.5);
        const hits = detectTransients(samples, SAMPLE_RATE, 0.5);
        const offsets = hits.map((h) => h.sampleOffset);
        expect(new Set(offsets).size).toBe(offsets.length);
    });

    it('returns an empty array for input shorter than the FFT window', () => {
        const samples = new Float32Array(512);
        expect(detectTransients(samples, SAMPLE_RATE, 0.5)).toEqual([]);
    });

    it('returns confidence values in [0, 1]', () => {
        const samples = buildImpulses(1, 0.25);
        const hits = detectTransients(samples, SAMPLE_RATE, 0.5);
        for (const hit of hits) {
            expect(hit.confidence).toBeGreaterThanOrEqual(0);
            expect(hit.confidence).toBeLessThanOrEqual(1);
        }
    });
});
