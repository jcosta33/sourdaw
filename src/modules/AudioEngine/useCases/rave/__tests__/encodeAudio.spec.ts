import { describe, expect, it } from 'vitest';

import { encodeAudio } from '../encodeAudio';

describe('encodeAudio', () => {
    it('should return no vectors when the buffer is empty', () => {
        expect(encodeAudio(new Float32Array(0), 48_000, 8)).toEqual([]);
    });

    it('should return no vectors when the buffer is shorter than one frame', () => {
        const sampleRate = 48_000;
        const frameSize = Math.floor(sampleRate * 0.02);
        const samples = new Float32Array(frameSize);
        expect(encodeAudio(samples, sampleRate, 8)).toEqual([]);
    });

    it('should emit one latent vector per 20ms frame with the requested dimension', () => {
        const sampleRate = 48_000;
        const frameSize = Math.floor(sampleRate * 0.02);
        const latentDim = 4;
        const samples = new Float32Array(frameSize * 3).fill(0.01);
        const vectors = encodeAudio(samples, sampleRate, latentDim);

        expect(vectors.length).toBe(2);
        expect(vectors[0]!.values).toHaveLength(latentDim);
        expect(vectors[0]!.timeSec).toBe(0);
        expect(vectors[1]!.timeSec).toBeCloseTo(frameSize / sampleRate);
        expect(vectors.every((value) => value.values.every((x) => Number.isFinite(x)))).toBe(true);
    });
});
