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

type UpdateClipFn = (clip_id: string, updater: (clip: Clip) => Clip) => boolean;

const mocks = vi.hoisted(() => ({
    computeNormalizationScale:
        vi.fn<(buffer: CachedBuffer, mode: NormalizationMode, target_db?: number) => number | null>(),
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => CachedBuffer | null>(),
    getTrackState: vi.fn<() => TrackState | null>(),
    resolveEligibleClipWriteTarget: vi.fn(),
    updateClip: vi.fn<UpdateClipFn>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

vi.mock('../../../transformers/clipDspTransformers', () => ({
    computeNormalizationScale: mocks.computeNormalizationScale,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
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
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            clipId: 'clip-1',
        });
        mocks.updateClip.mockReturnValue(true);
    });

    it('should read the source buffer through AudioEngine and set gain to the normalization scale', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buffer-1',
            gain: 0.5,
        });
        const cached_buffer: CachedBuffer = { marker: 'cached-buffer' };
        mocks.getTrackState.mockReturnValue(create_track_state(clip));
        mocks.getCachedAudioBuffer.mockReturnValue(cached_buffer);
        mocks.computeNormalizationScale.mockReturnValue(1.75);

        const didWrite = normalizeClip('clip-1', 'rms', -18);

        expect(didWrite).toBe(true);
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
            gain: 1.75,
        });
    });

    it('does not write when the clip already has the normalization gain', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buffer-1',
            gain: 1.75,
        });
        const cached_buffer: CachedBuffer = { marker: 'cached-buffer' };
        mocks.getTrackState.mockReturnValue(create_track_state(clip));
        mocks.getCachedAudioBuffer.mockReturnValue(cached_buffer);
        mocks.computeNormalizationScale.mockReturnValue(1.75);

        const didWrite = normalizeClip('clip-1', 'rms', -18);

        expect(didWrite).toBe(false);
        expect(mocks.computeNormalizationScale).toHaveBeenCalledWith(cached_buffer, 'rms', -18);
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('caps normalization at the supported clip gain ceiling', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buffer-1',
            gain: 0.5,
        });
        mocks.getTrackState.mockReturnValue(create_track_state(clip));
        mocks.getCachedAudioBuffer.mockReturnValue({ marker: 'cached-buffer' });
        mocks.computeNormalizationScale.mockReturnValue(4);

        const didWrite = normalizeClip('clip-1');

        expect(didWrite).toBe(true);
        const updater = mocks.updateClip.mock.calls[0]?.[1];
        if (!updater) {
            throw new Error('Expected normalizeClip to pass an updater to updateClip');
        }
        expect(updater(clip).gain).toBe(2);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
        'rejects an invalid normalization gain of %s',
        (invalidGain) => {
            const clip = ClipDummy.create({
                id: 'clip-1',
                audioBufferId: 'buffer-1',
                gain: 0.5,
            });
            mocks.getTrackState.mockReturnValue(create_track_state(clip));
            mocks.getCachedAudioBuffer.mockReturnValue({ marker: 'cached-buffer' });
            mocks.computeNormalizationScale.mockReturnValue(invalidGain);

            const didWrite = normalizeClip('clip-1');

            expect(didWrite).toBe(false);
            expect(mocks.updateClip).not.toHaveBeenCalled();
        }
    );

    it('should not update gain when the source buffer is missing', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'missing-buffer',
            gain: 0.5,
        });
        mocks.getTrackState.mockReturnValue(create_track_state(clip));
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        const didWrite = normalizeClip('clip-1');

        expect(didWrite).toBe(false);
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

        const didWrite = normalizeClip('clip-1');

        expect(didWrite).toBe(false);
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buffer-1' });
        expect(mocks.computeNormalizationScale).toHaveBeenCalledWith(cached_buffer, 'peak', undefined);
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('rejects an ineligible owner before buffer lookup or normalization', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buffer-1' });
        mocks.getTrackState.mockReturnValue(create_track_state(clip));
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        const didWrite = normalizeClip('clip-1');

        expect(didWrite).toBe(false);
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.computeNormalizationScale).not.toHaveBeenCalled();
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('rejects when the track store has not loaded', () => {
        mocks.getTrackState.mockReturnValue(null);

        const didWrite = normalizeClip('clip-1');

        expect(didWrite).toBe(false);
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it.each([
        ['a midi clip', ClipDummy.create({ id: 'clip-1', type: 'midi' })],
        [
            'an audio clip without a buffer id',
            { ...ClipDummy.create({ id: 'clip-1', type: 'audio' }), audioBufferId: undefined },
        ],
    ])('rejects %s before buffer lookup', (_label, clip) => {
        mocks.getTrackState.mockReturnValue(create_track_state(clip));

        const didWrite = normalizeClip('clip-1');

        expect(didWrite).toBe(false);
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });
});
