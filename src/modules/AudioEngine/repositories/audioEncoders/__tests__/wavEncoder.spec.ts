import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { audioBufferToWav } from '../wavEncoder';

function createMockAudioBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: (ch: number) => data[ch],
    } as unknown as AudioBuffer;
}

describe('audioBufferToWav', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should encode a mono 16-bit WAV file with correct headers', async () => {
        const sampleRate = 44100;
        const length = 100;
        const buffer = createMockAudioBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        data[0] = 1.0;
        data[1] = -1.0;

        const promise = audioBufferToWav(buffer, 16);
        vi.runAllTimers();
        const arrayBuffer = await promise;
        const view = new DataView(arrayBuffer);

        // RIFF header
        expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe(
            'RIFF'
        );
        // WAVE header
        expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe(
            'WAVE'
        );
        // fmt header
        expect(String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15))).toBe(
            'fmt '
        );
        // AudioFormat (1 for PCM)
        expect(view.getUint16(20, true)).toBe(1);
        // NumChannels
        expect(view.getUint16(22, true)).toBe(1);
        // SampleRate
        expect(view.getUint32(24, true)).toBe(44100);
        // BitsPerSample
        expect(view.getUint16(34, true)).toBe(16);

        // Data samples (offset is 44 for 16-bit PCM)
        const dataOffset = 44;
        const s1 = view.getInt16(dataOffset, true);
        const s2 = view.getInt16(dataOffset + 2, true);

        // With dither, it might be off by 1
        expect(s1).toBeGreaterThanOrEqual(0x7ffe);
        expect(s1).toBeLessThanOrEqual(0x7fff);
        expect(s2).toBeLessThanOrEqual(-0x7fff);
        expect(s2).toBeGreaterThanOrEqual(-0x8000);
    });

    it('should encode a stereo 32-bit float WAV file', async () => {
        const sampleRate = 48000;
        const length = 10;
        const buffer = createMockAudioBuffer(2, length, sampleRate);
        buffer.getChannelData(0)[0] = 0.5;
        buffer.getChannelData(1)[0] = -0.5;

        const promise = audioBufferToWav(buffer, 32);
        vi.runAllTimers();
        const arrayBuffer = await promise;
        const view = new DataView(arrayBuffer);

        // AudioFormat (3 for IEEE Float)
        expect(view.getUint16(20, true)).toBe(3);
        // BitsPerSample
        expect(view.getUint16(34, true)).toBe(32);

        // Data samples (offset is 46 for 32-bit Float as it has 2 extra bytes in fmt)
        const dataOffset = 46;
        expect(view.getFloat32(dataOffset, true)).toBe(0.5);
        expect(view.getFloat32(dataOffset + 4, true)).toBe(-0.5);
    });

    it('should call onProgress during encoding', async () => {
        const sampleRate = 44100;
        const length = 40000; // Larger than yield interval (32768)
        const buffer = createMockAudioBuffer(1, length, sampleRate);
        const onProgress = vi.fn();

        const promise = audioBufferToWav(buffer, 16, onProgress);

        // Wait for first yield
        await vi.runAllTimersAsync();

        expect(onProgress).toHaveBeenCalled();
        const result = await promise;
        expect(result).toBeDefined();
        expect(onProgress).toHaveBeenCalledWith(1);
    });

    it('normalizes down when the mix peak exceeds full scale', async () => {
        // A hot mix (peak 2.0) must be scaled by 1/peak = 0.5 so peaks land at
        // full scale — not hard-clamped to a flat top. Use 32-bit float so the
        // written samples are read back exactly (no dither / quantization).
        const buffer = createMockAudioBuffer(1, 4, 48000);
        const data = buffer.getChannelData(0);
        data[0] = 2.0;
        data[1] = -1.0;
        data[2] = 0.5;
        data[3] = 0;

        const promise = audioBufferToWav(buffer, 32);
        vi.runAllTimers();
        const view = new DataView(await promise);

        const dataOffset = 46;
        expect(view.getFloat32(dataOffset, true)).toBeCloseTo(1.0, 6); // 2.0 * 0.5
        expect(view.getFloat32(dataOffset + 4, true)).toBeCloseTo(-0.5, 6); // -1.0 * 0.5
        expect(view.getFloat32(dataOffset + 8, true)).toBeCloseTo(0.25, 6); // 0.5 * 0.5
    });

    it('leaves sub-full-scale audio at its authored level (no upward normalization)', async () => {
        const buffer = createMockAudioBuffer(1, 3, 48000);
        const data = buffer.getChannelData(0);
        data[0] = 0.5;
        data[1] = -0.25;
        data[2] = 0.75;

        const promise = audioBufferToWav(buffer, 32);
        vi.runAllTimers();
        const view = new DataView(await promise);

        const dataOffset = 46;
        expect(view.getFloat32(dataOffset, true)).toBe(0.5);
        expect(view.getFloat32(dataOffset + 4, true)).toBe(-0.25);
        expect(view.getFloat32(dataOffset + 8, true)).toBe(0.75);
    });
});
