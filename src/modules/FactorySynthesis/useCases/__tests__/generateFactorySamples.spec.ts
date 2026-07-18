import { describe, it, expect } from 'vitest';

import { generateFactorySamples } from '../generateFactorySamples';

type MutableBuffer = {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    duration: number;
    channels: Float32Array[];
    getChannelData: (idx: number) => Float32Array;
};

function createMockAudioContext(): AudioContext {
    return {
        createBuffer: (channels: number, length: number, sampleRate: number): MutableBuffer => {
            const chans: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(length));
            return {
                numberOfChannels: channels,
                length,
                sampleRate,
                duration: length / sampleRate,
                channels: chans,
                getChannelData: (idx: number) => chans[idx]!,
            };
        },
    } as unknown as AudioContext;
}

describe('generateFactorySamples', () => {
    it('produces at least 60 samples across drums, bass, keys and fx categories', () => {
        const ctx = createMockAudioContext();
        const samples = generateFactorySamples(ctx);

        expect(samples.length).toBeGreaterThanOrEqual(60);

        const categories = new Set(samples.map((s) => s.category));
        expect(categories.has('drums')).toBe(true);
        expect(categories.has('bass')).toBe(true);
        expect(categories.has('keys')).toBe(true);
        expect(categories.has('fx')).toBe(true);
    });

    it('gives every sample a unique stable id', () => {
        const ctx = createMockAudioContext();
        const samples = generateFactorySamples(ctx);
        const ids = new Set(samples.map((s) => s.id));
        expect(ids.size).toBe(samples.length);
    });

    it('fills each buffer with non-silent audio data', () => {
        const ctx = createMockAudioContext();
        const samples = generateFactorySamples(ctx);
        for (const sample of samples) {
            const data = sample.buffer.getChannelData(0);
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

    it('marks factory bass samples at MIDI pitch 24 (C1)', () => {
        const ctx = createMockAudioContext();
        const bass = generateFactorySamples(ctx).filter((s) => s.category === 'bass');
        expect(bass.length).toBeGreaterThan(0);
        for (const b of bass) {
            expect(b.pitch).toBe(24);
        }
    });

    it('marks factory keys samples at MIDI pitch 48 (C3)', () => {
        const ctx = createMockAudioContext();
        const keys = generateFactorySamples(ctx).filter((s) => s.category === 'keys');
        expect(keys.length).toBeGreaterThan(0);
        for (const k of keys) {
            expect(k.pitch).toBe(48);
        }
    });
});
