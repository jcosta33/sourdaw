import { describe, it, expect } from 'vitest';

import { createMono, createStereo, toAudioBufferMono } from '../bufferCreation';
import { mixMono, mixMonoIntoStereo } from '../mixing';

describe('mixMono', () => {
    it('adds source into destination', () => {
        const dst = new Float32Array([1, 2, 3]);
        const src = new Float32Array([0.5, 0.5, 0.5]);
        mixMono(dst, src, 1);
        expect(Array.from(dst)).toEqual([1.5, 2.5, 3.5]);
    });

    it('applies gain', () => {
        const dst = new Float32Array([1, 1]);
        const src = new Float32Array([1, 1]);
        mixMono(dst, src, 0.5);
        expect(Array.from(dst)).toEqual([1.5, 1.5]);
    });

    it('respects offset', () => {
        const dst = new Float32Array([0, 0, 0, 0]);
        const src = new Float32Array([1, 1]);
        mixMono(dst, src, 1, 2);
        expect(dst[0]).toBe(0);
        expect(dst[1]).toBe(0);
        expect(dst[2]).toBe(1);
        expect(dst[3]).toBe(1);
    });

    it('does not overflow destination', () => {
        const dst = new Float32Array([0, 0]);
        const src = new Float32Array([1, 1, 1, 1]);
        mixMono(dst, src, 1);
        expect(dst.length).toBe(2);
    });

    it('handles negative offset', () => {
        const dst = new Float32Array([0, 0, 0]);
        const src = new Float32Array([1, 1, 1, 1, 1]);
        mixMono(dst, src, 1, -2);
        expect(dst[0]).toBe(1);
    });
});

describe('mixMonoIntoStereo', () => {
    it('distributes across left and right by pan', () => {
        const dst: [Float32Array, Float32Array] = [new Float32Array(2), new Float32Array(2)];
        const src = new Float32Array([1, 1]);
        mixMonoIntoStereo(dst, src, 1, 0); // center pan
        expect(dst[0][0]).toBeCloseTo(dst[1][0]!, 5);
    });

    it('full-left pan sends more to left', () => {
        const dst: [Float32Array, Float32Array] = [new Float32Array(1), new Float32Array(1)];
        mixMonoIntoStereo(dst, new Float32Array([1]), 1, -1);
        expect(dst[0][0]).toBeGreaterThan(dst[1][0]!);
    });

    it('full-right pan sends more to right', () => {
        const dst: [Float32Array, Float32Array] = [new Float32Array(1), new Float32Array(1)];
        mixMonoIntoStereo(dst, new Float32Array([1]), 1, 1);
        expect(dst[1][0]).toBeGreaterThan(dst[0][0]!);
    });
});

describe('createMono', () => {
    it('creates Float32Array of correct length', () => {
        const buf = createMono(0.5, 48000);
        expect(buf).toBeInstanceOf(Float32Array);
        expect(buf.length).toBe(24000);
    });

    it('returns minimum 1 sample', () => {
        const buf = createMono(0, 48000);
        expect(buf.length).toBe(1);
    });

    it('is initialized to zeros', () => {
        const buf = createMono(0.01, 48000);
        expect(buf.every((v) => v === 0)).toBe(true);
    });
});

describe('createStereo', () => {
    it('creates two Float32Arrays', () => {
        const [l, r] = createStereo(0.1, 48000);
        expect(l.length).toBe(4800);
        expect(r.length).toBe(4800);
    });
});

describe('toAudioBufferMono', () => {
    it('creates AudioBuffer with correct length and sample rate', () => {
        const ctx = {
            createBuffer: (_ch: number, length: number, sampleRate: number) => {
                const data = new Float32Array(length);
                return {
                    length,
                    sampleRate,
                    numberOfChannels: 1,
                    duration: length / sampleRate,
                    getChannelData: () => data,
                };
            },
        } as unknown as AudioContext;
        const src = new Float32Array(100).fill(0.5);
        const buf = toAudioBufferMono(ctx, src, 48000);
        expect(buf.length).toBe(100);
        expect(buf.sampleRate).toBe(48000);
    });
});
