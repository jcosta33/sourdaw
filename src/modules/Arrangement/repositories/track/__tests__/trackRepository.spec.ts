import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../stores/trackStore', () => {
    const internal = { value: { tracks: [], selectedTrackId: null } };
    return {
        trackStore: {
            get value() { return internal.value; },
            set: vi.fn((v) => { internal.value = v; }),
            update: vi.fn((cb) => {
                internal.value = cb(internal.value);
            }),
        },
    };
});

import { trackStore } from '../../../stores/trackStore';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { ClipDummy } from '../../../__tests__/ClipDummy';

import { getAllTracks } from '../getAllTracks';
import { getTrackById } from '../getTrackById';
import { getTrackState } from '../getTrackState';
import { mapAllTracks } from '../mapAllTracks';
import { setTrackState } from '../setTrackState';
import { updateTrack } from '../updateTrack';
import { updateTracks } from '../updateTracks';
import { updateTrackState } from '../updateTrackState';
import { updateClip } from '../updateClip';
import { updateClipsOnAllTracks } from '../updateClipsOnAllTracks';

describe('trackRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    describe('getAllTracks', () => {
        it('should return all tracks from the store', () => {
            const tracks = [TrackDummy.create({ id: 't1' })];
            trackStore.set({ tracks, selectedTrackId: null });
            expect(getAllTracks()).toEqual(tracks);
        });
    });

    describe('getTrackById', () => {
        it('should return the track with the given ID', () => {
            const t1 = TrackDummy.create({ id: 't1' });
            const tracks = [t1, TrackDummy.create({ id: 't2' })];
            trackStore.set({ tracks, selectedTrackId: null });
            expect(getTrackById('t1')).toEqual(t1);
        });

        it('should return undefined if track is not found', () => {
            trackStore.set({ tracks: [], selectedTrackId: null });
            expect(getTrackById('non-existent')).toBeUndefined();
        });
    });

    describe('getTrackState', () => {
        it('should return the whole track store state', () => {
            const state = { tracks: [], selectedTrackId: 't1' };
            trackStore.set(state as any);
            expect(getTrackState()).toEqual(state);
        });
    });

    describe('mapAllTracks', () => {
        it('should update all tracks via the mapper function', () => {
            const tracks = [TrackDummy.create({ id: 't1', name: 'A' }), TrackDummy.create({ id: 't2', name: 'B' })];
            trackStore.set({ tracks, selectedTrackId: null });
            
            mapAllTracks((t) => ({ ...t, name: t.name + '!' }));
            
            expect(trackStore.value!.tracks[0].name).toBe('A!');
            expect(trackStore.value!.tracks[1].name).toBe('B!');
        });
    });

    describe('setTrackState', () => {
        it('should set the whole track store state', () => {
            const state = { tracks: [], selectedTrackId: 't1' };
            setTrackState(state as any);
            expect(trackStore.set).toHaveBeenCalledWith(state);
            expect(trackStore.value).toEqual(state);
        });
    });

    describe('updateTrack', () => {
        it('should update a specific track by ID', () => {
            const t1 = TrackDummy.create({ id: 't1', name: 'Old' });
            trackStore.set({ tracks: [t1], selectedTrackId: null });
            
            updateTrack('t1', (t) => ({ ...t, name: 'New' }));
            
            expect(trackStore.value!.tracks[0].name).toBe('New');
        });
    });

    describe('updateTracks', () => {
        it('should update tracks matching a predicate', () => {
            const tracks = [
                TrackDummy.create({ id: 't1', muted: false }),
                TrackDummy.create({ id: 't2', muted: false })
            ];
            trackStore.set({ tracks, selectedTrackId: null });
            
            // Mute only t1
            updateTracks((t) => t.id === 't1', (t) => ({ ...t, muted: true }));
            
            expect(trackStore.value!.tracks[0].muted).toBe(true);
            expect(trackStore.value!.tracks[1].muted).toBe(false);
        });
    });

    describe('updateTrackState', () => {
        it('should partially update the track store state', () => {
            trackStore.set({ tracks: [], selectedTrackId: 'old' });
            updateTrackState({ selectedTrackId: 'new' });
            expect(trackStore.value!.selectedTrackId).toBe('new');
        });
    });

    describe('updateClip', () => {
        it('should update a single clip by id across all tracks', () => {
            const clip = ClipDummy.create({ id: 'c1', name: 'Old' });
            const track = TrackDummy.create({ id: 't1', clips: [clip] });
            trackStore.set({ tracks: [track], selectedTrackId: null });
            
            updateClip('c1', (c) => ({ ...c, name: 'New' }));
            
            expect(trackStore.value!.tracks[0].clips[0].name).toBe('New');
        });
    });

    describe('updateClipsOnAllTracks', () => {
        it('should update all clips across all tracks', () => {
            const c1 = ClipDummy.create({ id: 'c1', muted: false });
            const c2 = ClipDummy.create({ id: 'c2', muted: false });
            const t1 = TrackDummy.create({ id: 't1', clips: [c1] });
            const t2 = TrackDummy.create({ id: 't2', clips: [c2] });
            trackStore.set({ tracks: [t1, t2], selectedTrackId: null });
            
            updateClipsOnAllTracks((c) => ({ ...c, muted: true }));
            
            expect(trackStore.value!.tracks[0].clips[0].muted).toBe(true);
            expect(trackStore.value!.tracks[1].clips[0].muted).toBe(true);
        });
    });
});
