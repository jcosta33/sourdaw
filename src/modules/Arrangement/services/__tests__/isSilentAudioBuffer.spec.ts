import { describe, it, expect } from 'vitest';

import { isSilentAudioBuffer, type SilenceScannableBuffer } from '../isSilentAudioBuffer';

function bufferOf(...channels: number[][]): SilenceScannableBuffer {
    const data = channels.map((samples) => Float32Array.from(samples));
    return {
        numberOfChannels: data.length,
        getChannelData: (channel: number) => data[channel] ?? new Float32Array(0),
    };
}

describe('isSilentAudioBuffer', () => {
    it('reports digital silence for an all-zero buffer', () => {
        expect(isSilentAudioBuffer(bufferOf([0, 0, 0], [0, 0, 0]))).toBe(true);
    });

    it('reports silence for denormal-scale dust below the -100 dBFS floor', () => {
        expect(isSilentAudioBuffer(bufferOf([0, 1e-7, -1e-7]))).toBe(true);
    });

    it('reports audio for a sample above the floor', () => {
        expect(isSilentAudioBuffer(bufferOf([0, 0, 1e-4]))).toBe(false);
    });

    it('reports audio when only the second channel carries signal', () => {
        expect(isSilentAudioBuffer(bufferOf([0, 0], [0, -0.5]))).toBe(false);
    });

    it('treats a NaN sample as not-silence, leaving a broken buffer to a different refusal', () => {
        expect(isSilentAudioBuffer(bufferOf([0, Number.NaN, 0]))).toBe(false);
    });

    it('treats an infinite sample as not-silence', () => {
        expect(isSilentAudioBuffer(bufferOf([0, Number.POSITIVE_INFINITY]))).toBe(false);
    });
});
