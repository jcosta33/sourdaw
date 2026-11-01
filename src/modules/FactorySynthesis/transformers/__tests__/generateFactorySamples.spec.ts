import { describe, it, expect } from 'vitest';

import { generateFactorySamples } from '../generateFactorySamples';

describe('generateFactorySamples', () => {
    it('produces at least 60 samples across drums, bass, keys and fx categories', () => {
        const samples = generateFactorySamples();

        expect(samples.length).toBeGreaterThanOrEqual(60);

        const categories = new Set(samples.map((s) => s.category));
        expect(categories.has('drums')).toBe(true);
        expect(categories.has('bass')).toBe(true);
        expect(categories.has('keys')).toBe(true);
        expect(categories.has('fx')).toBe(true);
    });

    it('gives every sample a unique stable id', () => {
        const samples = generateFactorySamples();
        const ids = new Set(samples.map((s) => s.id));
        expect(ids.size).toBe(samples.length);
    });

    it('fills each sample with non-silent audio data', () => {
        const samples = generateFactorySamples();
        for (const sample of samples) {
            const data = sample.channels[0]!;
            let peak = 0;
            for (let i = 0; i < data.length; i++) {
                const a = Math.abs(data[i]!);
                if (a > peak) {
                    peak = a;
                }
            }
            expect(peak).toBeGreaterThan(0);
        }
    });

    it('renders mono packs as one channel and fx packs as two equal-length channels at 44.1 kHz', () => {
        for (const sample of generateFactorySamples()) {
            expect(sample.sampleRate).toBe(44100);
            expect(sample.channels).toHaveLength(sample.category === 'fx' ? 2 : 1);
            for (const channel of sample.channels) {
                expect(channel.length).toBe(sample.channels[0]!.length);
            }
        }
    });

    it('marks factory bass samples at MIDI pitch 24 (C1)', () => {
        const bass = generateFactorySamples().filter((s) => s.category === 'bass');
        expect(bass.length).toBeGreaterThan(0);
        for (const b of bass) {
            expect(b.pitch).toBe(24);
        }
    });

    it('marks factory keys samples at MIDI pitch 48 (C3)', () => {
        const keys = generateFactorySamples().filter((s) => s.category === 'keys');
        expect(keys.length).toBeGreaterThan(0);
        for (const k of keys) {
            expect(k.pitch).toBe(48);
        }
    });
});
