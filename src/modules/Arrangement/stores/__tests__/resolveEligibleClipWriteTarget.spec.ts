import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { normalizeTrack, type Clip, type Track } from '../../models/Track';
import { resolveEligibleClipWriteTarget } from '../resolveEligibleClipWriteTarget';
import { defaultTrackState, trackStore } from '../trackStore';

function makeClip(id: string, trackId: string): Clip {
    return {
        id,
        trackId,
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#fff',
        locked: false,
        muted: false,
    };
}

function makeTrack(id: string, clipIds: string[] = []): Track {
    return normalizeTrack({
        id,
        name: id,
        kind: 'audio',
        clips: clipIds.map((clipId) => makeClip(clipId, id)),
    });
}

function setRuntimeKind(track: Track, kind: string): Track {
    Object.defineProperty(track, 'kind', { configurable: true, enumerable: true, value: kind });
    return track;
}

function setTracks(tracks: Track[]): void {
    trackStore.set({ ...defaultTrackState, tracks });
}

describe('resolveEligibleClipWriteTarget', () => {
    beforeEach(() => {
        setTracks([]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        setTracks([]);
    });

    it('returns immutable stable IDs for eligible add and update targets', () => {
        setTracks([makeTrack('track-1', ['clip-1'])]);

        const addTarget = resolveEligibleClipWriteTarget({ trackId: 'track-1' });
        const updateTarget = resolveEligibleClipWriteTarget({ clipId: 'clip-1' });

        expect(addTarget).toEqual({ status: 'eligible', trackId: 'track-1' });
        expect(updateTarget).toEqual({ status: 'eligible', trackId: 'track-1', clipId: 'clip-1' });
        expect(Object.isFrozen(addTarget)).toBe(true);
        expect(Object.isFrozen(updateTarget)).toBe(true);
        if (updateTarget.status === 'eligible' && 'clipId' in updateTarget) {
            expectTypeOf(updateTarget.trackId).toEqualTypeOf<string>();
            expectTypeOf(updateTarget.clipId).toEqualTypeOf<string>();
        }
    });

    it('distinguishes missing targets from ineligible VCA ownership', () => {
        setTracks([makeTrack('track-1', ['clip-1'])]);

        expect(resolveEligibleClipWriteTarget({ trackId: 'missing' })).toEqual({ status: 'missing' });
        expect(resolveEligibleClipWriteTarget({ clipId: 'missing' })).toEqual({ status: 'missing' });

        const vcaTrack = setRuntimeKind(makeTrack('vca-1', ['vca-clip']), 'vca');
        setTracks([vcaTrack]);
        expect(resolveEligibleClipWriteTarget({ trackId: 'vca-1' })).toEqual({ status: 'ineligible' });
        expect(resolveEligibleClipWriteTarget({ clipId: 'vca-clip' })).toEqual({ status: 'ineligible' });
    });

    it('returns missing when store state does not exist', () => {
        vi.spyOn(trackStore, 'value', 'get').mockReturnValue(null);

        expect(resolveEligibleClipWriteTarget({ trackId: 'track-1' })).toEqual({ status: 'missing' });
        expect(resolveEligibleClipWriteTarget({ clipId: 'clip-1' })).toEqual({ status: 'missing' });
    });

    it('fails closed for duplicate track and clip identities', () => {
        setTracks([makeTrack('duplicate-track'), makeTrack('duplicate-track')]);
        expect(resolveEligibleClipWriteTarget({ trackId: 'duplicate-track' })).toEqual({ status: 'ineligible' });

        setTracks([makeTrack('track-1', ['duplicate-clip']), makeTrack('track-2', ['duplicate-clip'])]);
        expect(resolveEligibleClipWriteTarget({ clipId: 'duplicate-clip' })).toEqual({ status: 'ineligible' });
    });

    it('fails closed for malformed kinds and empty identities', () => {
        setTracks([setRuntimeKind(makeTrack('future-track', ['future-clip']), 'future-kind')]);

        expect(resolveEligibleClipWriteTarget({ trackId: 'future-track' })).toEqual({ status: 'ineligible' });
        expect(resolveEligibleClipWriteTarget({ clipId: 'future-clip' })).toEqual({ status: 'ineligible' });
        expect(resolveEligibleClipWriteTarget({ trackId: '' })).toEqual({ status: 'ineligible' });
        expect(resolveEligibleClipWriteTarget({ clipId: '' })).toEqual({ status: 'ineligible' });
    });

    it('fails closed when runtime callers provide both or neither identity', () => {
        setTracks([makeTrack('track-1', ['clip-1'])]);

        const both: unknown = Reflect.apply(resolveEligibleClipWriteTarget, undefined, [
            { trackId: 'track-1', clipId: 'clip-1' },
        ]);
        const neither: unknown = Reflect.apply(resolveEligibleClipWriteTarget, undefined, [{}]);

        expect(both).toEqual({ status: 'ineligible' });
        expect(neither).toEqual({ status: 'ineligible' });
    });
});
