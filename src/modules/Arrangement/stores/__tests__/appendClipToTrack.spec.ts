import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Clip, createTrack } from '../../models/Track';
import { appendClipToTrack } from '../appendClipToTrack';
import { trackStore } from '../trackStore';

function makeClip(overrides: Partial<Clip> & Pick<Clip, 'id' | 'trackId'>): Clip {
    return {
        name: 'Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

describe('appendClipToTrack', () => {
    beforeEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('appends a valid clip to an eligible audio track', () => {
        const track = createTrack({ id: 't1', name: 'Guitar', kind: 'audio' });
        trackStore.set({ tracks: [track], selectedTrackId: null });
        const clip = makeClip({ id: 'c1', trackId: 't1' });

        const didWrite = appendClipToTrack('t1', clip);

        expect(didWrite).toBe(true);
        expect(trackStore.value?.tracks[0]?.clips.map((c) => c.id)).toEqual(['c1']);
    });

    it('rejects an empty clip id', () => {
        const track = createTrack({ id: 't1', name: 'Guitar', kind: 'audio' });
        trackStore.set({ tracks: [track], selectedTrackId: null });
        const clip = makeClip({ id: '', trackId: 't1' });

        expect(appendClipToTrack('t1', clip)).toBe(false);
        expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
    });

    it('rejects a clip whose trackId does not match the resolved target', () => {
        const track = createTrack({ id: 't1', name: 'Guitar', kind: 'audio' });
        trackStore.set({ tracks: [track], selectedTrackId: null });
        const clip = makeClip({ id: 'c1', trackId: 'other' });

        expect(appendClipToTrack('t1', clip)).toBe(false);
    });

    it('rejects a clip that already exists on the track', () => {
        const existing = makeClip({ id: 'c1', trackId: 't1' });
        const track = createTrack({ id: 't1', name: 'Guitar', kind: 'audio' });
        trackStore.set({ tracks: [{ ...track, clips: [existing] }], selectedTrackId: null });
        const dup = makeClip({ id: 'c1', trackId: 't1', startBeat: 8, endBeat: 12 });

        expect(appendClipToTrack('t1', dup)).toBe(false);
    });

    it('rejects when the track store has not loaded', () => {
        trackStore.set(null);
        const clip = makeClip({ id: 'c1', trackId: 't1' });

        expect(appendClipToTrack('t1', clip)).toBe(false);
    });

    it('rejects an ineligible (vca) target track', () => {
        const track = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(track, 'kind', { value: 'vca' });
        trackStore.set({ tracks: [track], selectedTrackId: null });
        const clip = makeClip({ id: 'c1', trackId: 'vca-1' });

        expect(appendClipToTrack('vca-1', clip)).toBe(false);
    });
});
