import { describe, it, expect, vi } from 'vitest';
import { wasmDecodedToAudioBuffer } from '../wasmDecodedToAudioBuffer';
import { createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';

describe('wasmDecodedToAudioBuffer', () => {
    it('should convert interleaved mono WASM audio to AudioBuffer', () => {
        const interleaved = new Float32Array([0.1, -0.2, 0.3]);
        const decoded = {
            interleaved,
            sampleRate: 44100,
            channels: 1,
            totalFrames: 3,
        };

        const ctx = createMockAudioContext();
        const mockBuffer = {
            numberOfChannels: 1,
            length: 3,
            sampleRate: 44100,
            getChannelData: vi.fn().mockReturnValue(new Float32Array(3)),
        };
        vi.mocked(ctx.createBuffer).mockReturnValue(mockBuffer as any);

        const buffer = wasmDecodedToAudioBuffer(decoded, ctx as any);

        expect(ctx.createBuffer).toHaveBeenCalledWith(1, 3, 44100);
        expect(buffer.getChannelData(0)).toEqual(interleaved);
    });

    it('should de-interleave stereo WASM audio to AudioBuffer', () => {
        // [L0, R0, L1, R1]
        const interleaved = new Float32Array([0.1, 0.5, 0.2, 0.6]);
        const decoded = {
            interleaved,
            sampleRate: 48000,
            channels: 2,
            totalFrames: 2,
        };

        const ctx = createMockAudioContext();
        const left = new Float32Array(2);
        const right = new Float32Array(2);
        const mockBuffer = {
            numberOfChannels: 2,
            length: 2,
            sampleRate: 48000,
            getChannelData: vi.fn((ch) => (ch === 0 ? left : right)),
        };
        vi.mocked(ctx.createBuffer).mockReturnValue(mockBuffer as any);

        const buffer = wasmDecodedToAudioBuffer(decoded, ctx as any);

        expect(ctx.createBuffer).toHaveBeenCalledWith(2, 2, 48000);
        expect(buffer.getChannelData(0)).toEqual(new Float32Array([0.1, 0.2]));
        expect(buffer.getChannelData(1)).toEqual(new Float32Array([0.5, 0.6]));
    });
});
