import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { findNearestZeroCrossing } from '../../transformers/clipDspTransformers';
import { snapSplitBeatToZeroCrossing } from '../snapSplitBeatToZeroCrossing';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: vi.fn(),
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        value: null,
    },
}));

vi.mock('../../transformers/clipDspTransformers', () => ({
    findNearestZeroCrossing: vi.fn(),
}));

describe('snapSplitBeatToZeroCrossing', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        transportStore.value = null;
    });

    it('should return the original split beat if the clip is not an audio clip', () => {
        const clip = ClipDummy.create({ type: 'midi' });
        expect(snapSplitBeatToZeroCrossing(clip, 2.5)).toBe(2.5);
    });

    it('should return the original split beat if the audio buffer is missing', () => {
        const clip = ClipDummy.create({ type: 'audio', audioBufferId: 'missing' });
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
        expect(snapSplitBeatToZeroCrossing(clip, 2.5)).toBe(2.5);
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'missing' });
    });

    it('should snap the split beat to the nearest zero crossing with fallback tempo', () => {
        const clip = ClipDummy.create({
            type: 'audio',
            audioBufferId: 'buf-1',
            startBeat: 1,
        });
        const channel_data = new Float32Array(100);
        const mock_buffer: AudioBuffer = {
            duration: 1,
            length: 48000,
            numberOfChannels: 1,
            sampleRate: 48000,
            copyFromChannel: vi.fn(),
            copyToChannel: vi.fn(),
            getChannelData: vi.fn(() => channel_data),
        };
        vi.mocked(getCachedAudioBuffer).mockReturnValue(mock_buffer);

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
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(findNearestZeroCrossing).toHaveBeenCalledWith(channel_data, 26400);
    });

    it('should use the live transport tempo when it is available', () => {
        const clip = ClipDummy.create({
            type: 'audio',
            audioBufferId: 'buf-1',
            startBeat: 1,
        });
        const channel_data = new Float32Array(100);
        const mock_buffer: AudioBuffer = {
            duration: 1,
            length: 48000,
            numberOfChannels: 1,
            sampleRate: 48000,
            copyFromChannel: vi.fn(),
            copyToChannel: vi.fn(),
            getChannelData: vi.fn(() => channel_data),
        };
        vi.mocked(getCachedAudioBuffer).mockReturnValue(mock_buffer);
        transportStore.value = { tempo: 60 } as typeof transportStore.value;
        vi.mocked(findNearestZeroCrossing).mockReturnValue(24000);

        const result = snapSplitBeatToZeroCrossing(clip, 2);

        expect(result).toBe(1.5);
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(findNearestZeroCrossing).toHaveBeenCalledWith(channel_data, 48000);
    });
});
