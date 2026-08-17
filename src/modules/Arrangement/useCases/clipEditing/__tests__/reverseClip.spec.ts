import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { reverseClip } from '../reverseClip';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateClip: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    clearClipPitchAnalysis: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
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
    clearClipPitchAnalysis: mocks.clearClipPitchAnalysis,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

describe('reverseClip', () => {
    let mockCtx: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            clipId: 'c1',
        });
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
        const events: string[] = [];
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.cacheAudioBuffer.mockImplementation(() => {
            events.push('cache');
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                events.push('publish');
                return true;
            }
        );

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

        const didWrite = reverseClip('c1');

        expect(didWrite).toBe(true);
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf1' });
        expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({
            buffer: reversedBuffer,
            bufferId: 'reversed-buf1-12345',
        });
        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
        expect(events).toEqual(['cache', 'publish']);
        expect(publishedClip?.audioBufferId).toBe('reversed-buf1-12345');
        expect(publishedClip?.name).toBe('Sample (reversed)');

        // Verify the math
        expect(reversedData[0]).toBe(0.5);
        expect(reversedData[99]).toBe(1.0);
    });

    it('clears the clip pitch contour after a successful reverse because the audio changed', () => {
        const mockClip = { id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' };
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                updater(mockClip);
                return true;
            }
        );
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

        expect(mocks.clearClipPitchAnalysis).toHaveBeenCalledWith('c1');
    });

    it('keeps the pitch contour when the clip cannot be reversed', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'c1', type: 'midi' }] }],
        });

        reverseClip('c1');

        expect(mocks.clearClipPitchAnalysis).not.toHaveBeenCalled();
    });

    it('does not publish cache or contour effects when the eligible update is not committed', () => {
        const mockClip = { id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' };
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: 4,
            sampleRate: 44100,
            getChannelData: vi.fn(() => new Float32Array(4)),
        });
        mockCtx.createBuffer.mockReturnValue({
            getChannelData: vi.fn(() => new Float32Array(4)),
        });
        mocks.updateClip.mockReturnValue(false);

        const didWrite = reverseClip('c1');

        expect(didWrite).toBe(false);
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.clearClipPitchAnalysis).not.toHaveBeenCalled();
    });

    it('bails if clip is not found or not audio', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'c1', type: 'midi' }] }],
        });

        reverseClip('c1');
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('rejects an ineligible owner before Web Audio, cache, update, or contour effects', () => {
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' }] }],
        });

        const didWrite = reverseClip('c1');

        expect(didWrite).toBe(false);
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mockCtx.createBuffer).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateClip).not.toHaveBeenCalled();
        expect(mocks.clearClipPitchAnalysis).not.toHaveBeenCalled();
    });

    it('rejects when the track store has not loaded', () => {
        mocks.getTrackState.mockReturnValue(null);

        const didWrite = reverseClip('c1');

        expect(didWrite).toBe(false);
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('rejects when the source buffer is not cached', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' }] }],
        });
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        const didWrite = reverseClip('c1');

        expect(didWrite).toBe(false);
        expect(mockCtx.createBuffer).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });
});
