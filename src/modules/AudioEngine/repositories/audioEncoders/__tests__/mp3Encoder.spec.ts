import { describe, it, expect, vi, beforeEach } from 'vitest';
import { audioBufferToMp3 } from '../mp3Encoder';

const mockEncoder = {
    encodeBuffer: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    flush: vi.fn().mockReturnValue(new Uint8Array([4, 5])),
};

vi.mock('@breezystack/lamejs', () => ({
    Mp3Encoder: vi.fn().mockImplementation(function() {
        return mockEncoder;
    }),
}));

describe('mp3Encoder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should encode a mono AudioBuffer to MP3', async () => {
        const buffer = {
            numberOfChannels: 1,
            length: 2304, // 2 * 1152 (BLOCK size)
            sampleRate: 44100,
            getChannelData: vi.fn().mockReturnValue(new Float32Array(2304).fill(0.1)),
        };

        const result = await audioBufferToMp3(buffer as any);

        expect(result).toBeDefined();
        // 2 blocks * 1 call each + flush
        expect(mockEncoder.encodeBuffer).toHaveBeenCalledTimes(2);
        expect(mockEncoder.flush).toHaveBeenCalled();
        
        // Final length should be (3 bytes * 2 blocks) + 2 bytes from flush = 8
        expect(result).toHaveLength(8);
    });

    it('should call onProgress during encoding', async () => {
        const buffer = {
            numberOfChannels: 1,
            length: 1152 * 100, // Large enough to trigger yield (yieldCounter % 64 === 0)
            sampleRate: 44100,
            getChannelData: vi.fn().mockReturnValue(new Float32Array(1152 * 100)),
        };
        const onProgress = vi.fn();

        await audioBufferToMp3(buffer as any, 128, onProgress);

        expect(onProgress).toHaveBeenCalled();
        expect(onProgress).toHaveBeenCalledWith(1); // Final call
    });
});
