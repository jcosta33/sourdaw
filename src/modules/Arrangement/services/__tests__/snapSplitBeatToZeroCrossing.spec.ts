import { describe, it, expect, vi, beforeEach } from 'vitest';
import { snapSplitBeatToZeroCrossing } from '../snapSplitBeatToZeroCrossing';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getTransportState } from '#/modules/Transport/useCases';
import { findNearestZeroCrossing } from '../../transformers/clipDspTransformers';
import { ClipDummy } from '../../__tests__/ClipDummy';

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        get: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: vi.fn(),
}));

vi.mock('../../transformers/clipDspTransformers', () => ({
    findNearestZeroCrossing: vi.fn(),
}));

describe('snapSplitBeatToZeroCrossing', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should return the original split beat if the clip is not an audio clip', () => {
        const clip = ClipDummy.create({ type: 'midi' });
        expect(snapSplitBeatToZeroCrossing(clip, 2.5)).toBe(2.5);
    });

    it('should return the original split beat if the audio buffer is missing', () => {
        const clip = ClipDummy.create({ type: 'audio', audioBufferId: 'missing' });
        vi.mocked(audioBufferCache.get).mockReturnValue(undefined);
        expect(snapSplitBeatToZeroCrossing(clip, 2.5)).toBe(2.5);
    });

    it('should snap the split beat to the nearest zero crossing', () => {
        const clip = ClipDummy.create({
            type: 'audio',
            audioBufferId: 'buf-1',
            startBeat: 1,
        });
        const mockBuffer = {
            sampleRate: 48000,
            getChannelData: vi.fn().mockReturnValue(new Float32Array(100)),
        };
        vi.mocked(audioBufferCache.get).mockReturnValue(mockBuffer as any);
        vi.mocked(getTransportState).mockReturnValue({ tempo: 120 } as any);
        
        // 120 bpm = 2 beats per second.
        // splitBeat = 2.1, startBeat = 1.0 -> relativeBeat = 1.1.
        // targetTime = 1.1 / 2 = 0.55s.
        // targetSample = 0.55 * 48000 = 26400.
        
        // Mock findNearestZeroCrossing to return sample 24000 (which is exactly 0.5s -> 1 beat)
        vi.mocked(findNearestZeroCrossing).mockReturnValue(24000);

        const result = snapSplitBeatToZeroCrossing(clip, 2.1);
        
        // snappedRelativeBeat = (24000 / 48000) * 2 = 1.0 beat.
        // result = startBeat (1.0) + snappedRelativeBeat (1.0) = 2.0.
        expect(result).toBe(2.0);
        expect(findNearestZeroCrossing).toHaveBeenCalledWith(expect.any(Float32Array), 26400);
    });
});
