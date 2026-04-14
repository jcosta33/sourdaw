import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeAudioBytesWasm } from '../decodeAudioBytesWasm';

const mockDecoded = {
    sample_rate: 44100,
    channels: 2,
    total_frames: 100,
    take_samples: vi.fn().mockReturnValue(new Float32Array(200)),
    free: vi.fn(),
};

const mockWasmModule = {
    default: vi.fn().mockResolvedValue(undefined),
    decode_audio_bytes: vi.fn().mockReturnValue(mockDecoded),
};

vi.mock('/wasm/daw-wasm-decoder/daw_wasm_decoder.js', () => mockWasmModule);

describe('decodeAudioBytesWasm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Force reload of the module-level lazy promise if possible, 
        // but since it's a singleton we mainly test the first success/fail.
    });

    it('should load module and decode bytes', async () => {
        const bytes = new ArrayBuffer(10);
        const result = await decodeAudioBytesWasm(bytes);

        expect(mockWasmModule.default).toHaveBeenCalled();
        expect(mockWasmModule.decode_audio_bytes).toHaveBeenCalled();
        expect(result).toEqual({
            interleaved: expect.any(Float32Array),
            sampleRate: 44100,
            channels: 2,
            totalFrames: 100,
        });
        expect(mockDecoded.take_samples).toHaveBeenCalled();
    });

    it('should return null if metadata is invalid', async () => {
        mockDecoded.total_frames = 0;
        const bytes = new ArrayBuffer(10);
        const result = await decodeAudioBytesWasm(bytes);
        
        expect(result).toBeNull();
        expect(mockDecoded.free).toHaveBeenCalled();
    });
});
