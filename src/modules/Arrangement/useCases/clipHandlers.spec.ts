import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createTrack, type Clip } from '../models/Track';
import { type TrackState } from '../repositories/track/getTrackState';
import { handleMoveClip } from '../handlers/clip/handleMoveClip';
import { moveClip } from './clip/moveClip';

describe('clipHandlers', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('handleMoveClip forwards to moveClip use case', () => {
        const clip: Clip = {
            id: 'c1',
            trackId: 't1',
            name: 'c',
            startBeat: 0,
            endBeat: 4,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#000',
            locked: false,
            muted: false,
        };
        const track = createTrack({ name: 'T', kind: 'audio', id: 't1' });
        track.clips = [clip];
        const state: TrackState = {
            tracks: [track],
            selectedTrackId: 't1',
        };
        const getTrackState = vi.fn((): TrackState => state);
        const setTrackState = vi.fn();
        injectDependencies(moveClip, { getTrackState, setTrackState });

        handleMoveClip.execute({
            type: 'moveClip',
            payload: { clipId: 'c1', trackId: 't1', startBeat: 4 },
        });

        expect(setTrackState).toHaveBeenCalled();
    });
});
