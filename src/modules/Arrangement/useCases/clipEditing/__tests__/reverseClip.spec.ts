import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reverseClip } from '../reverseClip';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateClip: vi.fn(),
    audioBufferCacheGet: vi.fn(),
    audioBufferCacheSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        get: mocks.audioBufferCacheGet,
        set: mocks.audioBufferCacheSet,
    }
}));

describe('reverseClip', () => {
    let mockCtx: any;

    beforeEach(() => {
        vi.clearAllMocks();
        
        mockCtx = {
            createBuffer: vi.fn(),
        };

        // Use regular function to satisfy 'constructor' check
        globalThis.OfflineAudioContext = function() {
            return mockCtx;
        } as any;
    });

    it('reverses an audio clip buffer and updates its ID', () => {
        const mockClip = { id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' };
        mocks.getTrackState.mockReturnValue({
            tracks: [{ clips: [mockClip] }]
        });

        const originalData = new Float32Array(100);
        originalData[0] = 1.0;
        originalData[99] = 0.5;

        const reversedData = new Float32Array(100);

        mocks.audioBufferCacheGet.mockReturnValue({
            numberOfChannels: 1,
            length: 100,
            sampleRate: 44100,
            getChannelData: vi.fn(() => originalData),
        });

        const reversedBuffer = {
            numberOfChannels: 1,
            length: 100,
            getChannelData: vi.fn(() => reversedData),
        };
        mockCtx.createBuffer.mockReturnValue(reversedBuffer);

        reverseClip('c1');

        expect(mocks.audioBufferCacheSet).toHaveBeenCalled();
        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
        
        const updater = mocks.updateClip.mock.calls[0][1];
        const result = updater(mockClip);
        expect(result.audioBufferId).toMatch(/^reversed-buf1-/);
        expect(result.name).toBe('Sample (reversed)');

        // Verify the math
        expect(reversedData[0]).toBe(0.5);
        expect(reversedData[99]).toBe(1.0);
    });

    it('bails if clip is not found or not audio', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ clips: [{ id: 'c1', type: 'midi' }] }]
        });

        reverseClip('c1');
        expect(mocks.audioBufferCacheSet).not.toHaveBeenCalled();
    });
});
