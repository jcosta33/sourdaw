import { describe, it, expect } from 'vitest';

import { audioBufferToWav } from '../audioBufferToWav';

describe('audioBufferToWav', () => {
    it('encodes an AudioBuffer to a 16-bit PCM WAV ArrayBuffer', () => {
        // Create a mock AudioBuffer
        const numChannels = 2;
        const length = 100;
        const sampleRate = 44100;
        const mockBuffer = {
            numberOfChannels: numChannels,
            length,
            sampleRate,
            getChannelData: (ch: number) => new Float32Array(length).fill(ch === 0 ? 0.5 : -0.5),
        } as AudioBuffer;

        const wavBuffer = audioBufferToWav(mockBuffer);

        expect(wavBuffer).toBeInstanceOf(ArrayBuffer);

        const dataLength = length * numChannels * 2; // 16-bit = 2 bytes
        const expectedTotalLength = 44 + dataLength;
        expect(wavBuffer.byteLength).toBe(expectedTotalLength);

        const view = new DataView(wavBuffer);

        // Check RIFF chunk
        expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe(
            'RIFF'
        );
        expect(view.getUint32(4, true)).toBe(36 + dataLength);
        expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe(
            'WAVE'
        );

        // Check fmt chunk
        expect(String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15))).toBe(
            'fmt '
        );
        expect(view.getUint16(20, true)).toBe(1); // PCM
        expect(view.getUint16(22, true)).toBe(numChannels);
        expect(view.getUint32(24, true)).toBe(sampleRate);
        expect(view.getUint16(34, true)).toBe(16); // bits per sample

        // Check data chunk
        expect(String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39))).toBe(
            'data'
        );
        expect(view.getUint32(40, true)).toBe(dataLength);

        // Check a sample value
        // Channel 0 was filled with 0.5 -> 0.5 * 0x7fff = 16383
        const ch0Sample = view.getInt16(44, true);
        expect(ch0Sample).toBe(16383);

        // Channel 1 was filled with -0.5 -> -0.5 * 0x8000 = -16384
        const ch1Sample = view.getInt16(46, true);
        expect(ch1Sample).toBe(-16384);
    });

    it('clamps samples to [-1, 1]', () => {
        const mockBuffer = {
            numberOfChannels: 1,
            length: 2,
            sampleRate: 44100,
            getChannelData: () => new Float32Array([1.5, -1.5]),
        } as AudioBuffer;

        const wavBuffer = audioBufferToWav(mockBuffer);
        const view = new DataView(wavBuffer);

        expect(view.getInt16(44, true)).toBe(0x7fff); // clamped to 1.0 -> 32767
        expect(view.getInt16(46, true)).toBe(-0x8000); // clamped to -1.0 -> -32768
    });
});
