import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockResolveEligible, mockGetTrackState, mockGetCachedAudioBuffer, mockComputeScale } = vi.hoisted(() => ({
    mockResolveEligible: vi.fn(),
    mockGetTrackState: vi.fn(),
    mockGetCachedAudioBuffer: vi.fn(),
    mockComputeScale: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({ getCachedAudioBuffer: mockGetCachedAudioBuffer }));
vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mockGetTrackState }));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mockResolveEligible,
}));
vi.mock('../../../transformers/clipDspTransformers', () => ({
    computeNormalizationScale: mockComputeScale,
}));

import { getClipNormalizationTargetGain } from '../getClipNormalizationTargetGain';

function eligibleClip(clipId: string, trackId: string) {
    return { status: 'eligible' as const, trackId, trackKind: 'audio', clipId };
}

function ineligible() {
    return { status: 'locked' as const };
}

function makeTrack(trackId: string, clips: Array<Record<string, unknown>>) {
    return { id: trackId, name: trackId, clips };
}

describe('getClipNormalizationTargetGain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when the clip is not eligible for writing', () => {
        mockResolveEligible.mockReturnValue(ineligible());
        const result = getClipNormalizationTargetGain('c1');
        expect(result).toBeNull();
    });

    it('returns null when track state is unavailable', () => {
        mockResolveEligible.mockReturnValue(eligibleClip('c1', 't1'));
        mockGetTrackState.mockReturnValue(null);
        const result = getClipNormalizationTargetGain('c1');
        expect(result).toBeNull();
    });

    it('returns null when the clip is not found or not audio type', () => {
        mockResolveEligible.mockReturnValue(eligibleClip('c1', 't1'));
        mockGetTrackState.mockReturnValue({
            tracks: [makeTrack('t1', [{ id: 'c1', type: 'midi' }])],
        });
        const result = getClipNormalizationTargetGain('c1');
        expect(result).toBeNull();
    });

    it('returns null when the audio buffer is not cached', () => {
        mockResolveEligible.mockReturnValue(eligibleClip('c1', 't1'));
        mockGetTrackState.mockReturnValue({
            tracks: [makeTrack('t1', [{ id: 'c1', type: 'audio', audioBufferId: 'buf-1' }])],
        });
        mockGetCachedAudioBuffer.mockReturnValue(null);
        const result = getClipNormalizationTargetGain('c1');
        expect(result).toBeNull();
    });

    it('returns null when normalization scale is null or non-positive', () => {
        mockResolveEligible.mockReturnValue(eligibleClip('c1', 't1'));
        mockGetTrackState.mockReturnValue({
            tracks: [makeTrack('t1', [{ id: 'c1', type: 'audio', audioBufferId: 'buf-1' }])],
        });
        mockGetCachedAudioBuffer.mockReturnValue({ numberOfChannels: 1 });
        mockComputeScale.mockReturnValue(null);
        const result = getClipNormalizationTargetGain('c1');
        expect(result).toBeNull();
    });

    it('returns the computed scale clamped to max 2', () => {
        mockResolveEligible.mockReturnValue(eligibleClip('c1', 't1'));
        mockGetTrackState.mockReturnValue({
            tracks: [makeTrack('t1', [{ id: 'c1', type: 'audio', audioBufferId: 'buf-1' }])],
        });
        mockGetCachedAudioBuffer.mockReturnValue({ numberOfChannels: 1 });
        mockComputeScale.mockReturnValue(5.0);
        const result = getClipNormalizationTargetGain('c1');
        expect(result).toBe(2);
    });

    it('returns the computed scale when within the clamp range', () => {
        mockResolveEligible.mockReturnValue(eligibleClip('c1', 't1'));
        mockGetTrackState.mockReturnValue({
            tracks: [makeTrack('t1', [{ id: 'c1', type: 'audio', audioBufferId: 'buf-1' }])],
        });
        mockGetCachedAudioBuffer.mockReturnValue({ numberOfChannels: 1 });
        mockComputeScale.mockReturnValue(1.5);
        const result = getClipNormalizationTargetGain('c1', 'peak', -3);
        expect(result).toBe(1.5);
        expect(mockComputeScale).toHaveBeenCalledWith({ numberOfChannels: 1 }, 'peak', -3);
    });
});
