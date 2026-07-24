import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { audioBufferToFlac } from '../flacEncoder';

function createMockAudioBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: (ch: number) => data[ch],
    } as unknown as AudioBuffer;
}

describe('flacEncoder', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should encode a mono AudioBuffer to FLAC', async () => {
        const sampleRate = 44100;
        const length = 100;
        const buffer = createMockAudioBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        data[0] = 1.0;
        data[1] = -1.0;

        const promise = audioBufferToFlac(buffer);
        vi.runAllTimers();
        const arrayBuffer = await promise;
        const view = new DataView(arrayBuffer.buffer);

        // fLaC signature
        expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe(
            'fLaC'
        );

        // STREAMINFO block type should be 0 (with last-metadata-block flag = 0x80)
        expect(view.getUint8(4)).toBe(0x80);

        // Min block size
        expect(view.getUint16(8, false)).toBe(4096);
    });

    it('should encode a stereo AudioBuffer to FLAC', async () => {
        const sampleRate = 48000;
        const length = 10;
        const buffer = createMockAudioBuffer(2, length, sampleRate);

        const promise = audioBufferToFlac(buffer);
        vi.runAllTimers();
        const arrayBuffer = await promise;
        const view = new DataView(arrayBuffer.buffer);

        // fLaC signature
        expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe(
            'fLaC'
        );
    });

    it('should call onProgress during encoding', async () => {
        const sampleRate = 44100;
        const length = 4096 * 20; // Enough to trigger yield (yields every 16 frames of 4096 samples)
        const buffer = createMockAudioBuffer(1, length, sampleRate);
        const onProgress = vi.fn();

        const promise = audioBufferToFlac(buffer, 16, onProgress);

        // Wait for first yield
        await vi.runAllTimersAsync();

        expect(onProgress).toHaveBeenCalled();
        const result = await promise;
        expect(result).toBeDefined();
        expect(onProgress).toHaveBeenCalledWith(1); // Final call
    });
});
