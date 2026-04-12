import { describe, expect, it } from 'vitest';

import { computeNormalizationScale, findNearestZeroCrossing } from '../clipDspTransformers';

function makeBuffer(samples: Float32Array, sampleRate = 48_000): AudioBuffer {
    return {
        numberOfChannels: 1,
        length: samples.length,
        sampleRate,
        duration: samples.length / sampleRate,
        getChannelData: () => samples,
    } as unknown as AudioBuffer;
}

function makeStereoBuffer(left: Float32Array, right: Float32Array, sampleRate = 48_000): AudioBuffer {
    return {
        numberOfChannels: 2,
        length: left.length,
        sampleRate,
        duration: left.length / sampleRate,
        getChannelData: (ch: number) => (ch === 0 ? left : right),
    } as unknown as AudioBuffer;
}

describe('findNearestZeroCrossing', () => {
    it('should return the closest sample index where the waveform crosses zero', () => {
        const data = new Float32Array([1, 0.5, -0.1, -0.5, 1]);
        expect(findNearestZeroCrossing(data, 2, 4)).toBe(1);
    });

    it('should return the target when no crossing exists in the window', () => {
        const data = new Float32Array([1, 1, 1, 1]);
        expect(findNearestZeroCrossing(data, 2, 2)).toBe(2);
    });
});

describe('computeNormalizationScale', () => {
    it('should return null for a silent buffer', () => {
        const silent = new Float32Array(64);
        expect(computeNormalizationScale(makeBuffer(silent), 'peak')).toBeNull();
    });

    it('should scale peak samples to unity by default', () => {
        const data = new Float32Array([0.25, -0.5, 0.25]);
        expect(computeNormalizationScale(makeBuffer(data), 'peak')).toBeCloseTo(2);
    });

    it('should use the maximum absolute sample across all channels for peak mode', () => {
        const left = new Float32Array([0.1, 0.1]);
        const right = new Float32Array([0.4, 0.4]);
        expect(computeNormalizationScale(makeStereoBuffer(left, right), 'peak')).toBeCloseTo(1 / 0.4);
    });

    it('should compute an RMS-based gain toward the target dBFS', () => {
        const data = new Float32Array(4).fill(0.1);
        const scale = computeNormalizationScale(makeBuffer(data), 'rms', -14);
        expect(scale).not.toBeNull();
        expect(scale! > 1).toBe(true);
    });

    it('should compute a gain for the LUFS-style band-weighted path', () => {
        const data = new Float32Array(128).fill(0.05);
        const scale = computeNormalizationScale(makeBuffer(data), 'lufs', -14);
        expect(scale).not.toBeNull();
        expect(scale!).toBeGreaterThan(0);
    });
});
