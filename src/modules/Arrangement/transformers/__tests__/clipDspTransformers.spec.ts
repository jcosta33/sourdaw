import { describe, it, expect } from 'vitest';

import { findNearestZeroCrossing, computeNormalizationScale } from '../clipDspTransformers';

describe('findNearestZeroCrossing', () => {
    it('finds exact zero crossing', () => {
        // [1, -1] crosses at sample 0→1
        const data = new Float32Array([1, -1]);
        const result = findNearestZeroCrossing(data, 0, 10);
        expect(result).toBe(0);
    });

    it('finds nearest crossing within window', () => {
        // Positive for 5 samples, then crosses to negative
        const data = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5]);
        const result = findNearestZeroCrossing(data, 3, 10);
        expect(result).toBe(4);
    });

    it('returns target when no crossing in window', () => {
        const data = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
        const result = findNearestZeroCrossing(data, 2, 2);
        expect(result).toBe(2);
    });

    it('handles data at boundary', () => {
        const data = new Float32Array([1, -1, -1, -1]);
        const result = findNearestZeroCrossing(data, 0, 5);
        expect(result).toBe(0);
    });

    it('handles empty data', () => {
        const data = new Float32Array([]);
        const result = findNearestZeroCrossing(data, 0, 5);
        expect(result).toBe(0);
    });
});

describe('computeNormalizationScale', () => {
    function make_buffer(channels: Float32Array[], sampleRate = 48000): AudioBuffer {
        const buf = {
            numberOfChannels: channels.length,
            sampleRate,
            length: channels[0]!.length,
            getChannelData: (ch: number) => channels[ch]!,
            duration: channels[0]!.length / sampleRate,
        } as AudioBuffer;
        return buf;
    }

    it('peak normalization: returns 1/peak', () => {
        const buf = make_buffer([new Float32Array([0.5, -0.5, 0.25, -0.25])]);
        const scale = computeNormalizationScale(buf, 'peak');
        expect(scale).toBeCloseTo(2.0);
    });

    it('peak normalization: returns null for silence', () => {
        const buf = make_buffer([new Float32Array([0, 0, 0, 0])]);
        expect(computeNormalizationScale(buf, 'peak')).toBeNull();
    });

    it('peak normalization: ignores target dB (returns 1/peak)', () => {
        const buf = make_buffer([new Float32Array([1.0, -1.0])]);
        const scale = computeNormalizationScale(buf, 'peak', -6);
        // Peak mode ignores targetDb, always normalizes to full scale
        expect(scale).toBeCloseTo(1.0);
    });

    it('rms normalization: produces positive scale for non-silent buffer', () => {
        const buf = make_buffer([new Float32Array([0.5, 0.5, 0.5, 0.5])]);
        const scale = computeNormalizationScale(buf, 'rms', -14);
        expect(scale).not.toBeNull();
        expect(scale).toBeGreaterThan(0);
    });

    it('rms normalization: returns null for silence', () => {
        const buf = make_buffer([new Float32Array([0, 0, 0, 0])]);
        expect(computeNormalizationScale(buf, 'rms')).toBeNull();
    });

    it('lufs normalization: produces positive scale for non-silent buffer', () => {
        const buf = make_buffer([new Float32Array(1000).fill(0.5)]);
        const scale = computeNormalizationScale(buf, 'lufs', -14);
        expect(scale).not.toBeNull();
        expect(scale).toBeGreaterThan(0);
    });

    it('lufs normalization: returns null for silence', () => {
        const buf = make_buffer([new Float32Array(1000).fill(0)]);
        expect(computeNormalizationScale(buf, 'lufs')).toBeNull();
    });

    it('defaults to peak mode', () => {
        const buf = make_buffer([new Float32Array([0.5, -0.5])]);
        const default_scale = computeNormalizationScale(buf);
        const peak_scale = computeNormalizationScale(buf, 'peak');
        expect(default_scale).toBeCloseTo(peak_scale!);
    });
});
