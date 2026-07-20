import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { type TrackState } from '../../../repositories/track/getTrackState';
import { type NormalizationMode } from '../../../transformers/clipDspTransformers';
import { normalizeClip } from '../normalizeClip';

type CachedBuffer = {
    readonly marker: 'cached-buffer';
};

type UpdateClipFn = (clip_id: string, updater: (clip: Clip) => Clip) => void;

const mocks = vi.hoisted(() => ({
    computeNormalizationScale:
        vi.fn<(buffer: CachedBuffer, mode: NormalizationMode, target_db?: number) => number | null>(),
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => CachedBuffer | null>(),
    getTrackState: vi.fn<() => TrackState | null>(),
    updateClip: vi.fn<UpdateClipFn>(),
    clearClipPitchContour: vi.fn<(clipId: string) => void>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

vi.mock('../../../transformers/clipDspTransformers', () => ({
    computeNormalizationScale: mocks.computeNormalizationScale,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('#/modules/Knead/useCases', () => ({
    clearClipPitchContour: mocks.clearClipPitchContour,
}));

function create_track_state(clip: Clip): TrackState {
    return {
        tracks: [TrackDummy.create({ clips: [clip] })],
        selectedTrackId: 'track-1',
        ghostClips: [],
    };
}

describe('normalizeClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should read the source buffer through AudioEngine and update gain by the normalization scale', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buffer-1',
            gain: 0.5,
        });
        const cached_buffer: CachedBuffer = { marker: 'cached-buffer' };
        mocks.getTrackState.mockReturnValue(create_track_state(clip));
        mocks.getCachedAudioBuffer.mockReturnValue(cached_buffer);
        mocks.computeNormalizationScale.mockReturnValue(1.75);

        normalizeClip('clip-1', 'rms', -18);

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buffer-1' });
        expect(mocks.computeNormalizationScale).toHaveBeenCalledWith(cached_buffer, 'rms', -18);
        expect(mocks.updateClip).toHaveBeenCalledTimes(1);
        expect(mocks.updateClip).toHaveBeenCalledWith('clip-1', expect.any(Function));

        const updater = mocks.updateClip.mock.calls[0]?.[1];
        if (!updater) {
            throw new Error('Expected normalizeClip to pass an updater to updateClip');
        }

        expect(updater(clip)).toEqual({
            ...clip,
            gain: 0.875,
        });
    });

    it('should not update gain when the source buffer is missing', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'missing-buffer',
            gain: 0.5,
        });
        mocks.getTrackState.mockReturnValue(create_track_state(clip));
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        normalizeClip('clip-1');

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'missing-buffer' });
        expect(mocks.computeNormalizationScale).not.toHaveBeenCalled();
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('should not update gain when normalization has no scale', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buffer-1',
            gain: 0.5,
        });
        const cached_buffer: CachedBuffer = { marker: 'cached-buffer' };
        mocks.getTrackState.mockReturnValue(create_track_state(clip));
        mocks.getCachedAudioBuffer.mockReturnValue(cached_buffer);
        mocks.computeNormalizationScale.mockReturnValue(null);

        normalizeClip('clip-1');

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buffer-1' });
        expect(mocks.computeNormalizationScale).toHaveBeenCalledWith(cached_buffer, 'peak', undefined);
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('should clear the clip pitch contour after a successful normalize because the audio changed', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buffer-1',
            gain: 0.5,
        });
        mocks.getTrackState.mockReturnValue(create_track_state(clip));
        mocks.getCachedAudioBuffer.mockReturnValue({ marker: 'cached-buffer' });
        mocks.computeNormalizationScale.mockReturnValue(1.75);

        normalizeClip('clip-1');

        expect(mocks.clearClipPitchContour).toHaveBeenCalledWith('clip-1');
    });

    it('should keep the pitch contour when normalization does not apply', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buffer-1',
            gain: 0.5,
        });
        mocks.getTrackState.mockReturnValue(create_track_state(clip));
        mocks.getCachedAudioBuffer.mockReturnValue({ marker: 'cached-buffer' });
        mocks.computeNormalizationScale.mockReturnValue(null);

        normalizeClip('clip-1');

        expect(mocks.clearClipPitchContour).not.toHaveBeenCalled();
    });
});
