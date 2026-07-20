import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { reverseClip } from '../reverseClip';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateClip: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    clearClipPitchContour: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('#/modules/Knead/useCases', () => ({
    clearClipPitchContour: mocks.clearClipPitchContour,
}));

describe('reverseClip', () => {
    let mockCtx: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockCtx = {
            createBuffer: vi.fn(),
        };

        // Use regular function to satisfy 'constructor' check
        globalThis.OfflineAudioContext = function () {
            return mockCtx;
        } as any;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reverses an audio clip buffer and updates its ID', () => {
        vi.spyOn(Date, 'now').mockReturnValue(12345);

        const mockClip = { id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' };
        mocks.getTrackState.mockReturnValue({
            tracks: [{ clips: [mockClip] }],
        });

        const originalData = new Float32Array(100);
        originalData[0] = 1.0;
        originalData[99] = 0.5;

        const reversedData = new Float32Array(100);

        mocks.getCachedAudioBuffer.mockReturnValue({
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

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf1' });
        expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({
            buffer: reversedBuffer,
            bufferId: 'reversed-buf1-12345',
        });
        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));

        const call = mocks.updateClip.mock.calls[0];
        if (!call) {
            throw new Error('expected updateClip to be called');
        }
        const updater = call[1];
        const result = updater(mockClip);
        expect(result.audioBufferId).toBe('reversed-buf1-12345');
        expect(result.name).toBe('Sample (reversed)');

        // Verify the math
        expect(reversedData[0]).toBe(0.5);
        expect(reversedData[99]).toBe(1.0);
    });

    it('clears the clip pitch contour after a successful reverse because the audio changed', () => {
        const mockClip = { id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' };
        mocks.getTrackState.mockReturnValue({
            tracks: [{ clips: [mockClip] }],
        });
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: 4,
            sampleRate: 44100,
            getChannelData: vi.fn(() => new Float32Array(4)),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: 4,
            getChannelData: vi.fn(() => new Float32Array(4)),
        });

        reverseClip('c1');

        expect(mocks.clearClipPitchContour).toHaveBeenCalledWith('c1');
    });

    it('keeps the pitch contour when the clip cannot be reversed', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ clips: [{ id: 'c1', type: 'midi' }] }],
        });

        reverseClip('c1');

        expect(mocks.clearClipPitchContour).not.toHaveBeenCalled();
    });

    it('bails if clip is not found or not audio', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ clips: [{ id: 'c1', type: 'midi' }] }],
        });

        reverseClip('c1');
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
    });
});
