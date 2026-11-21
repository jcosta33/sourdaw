import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { undoHistoryStore } from '#/modules/Command/stores';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { defaultTimelineEditingState, timelineEditingStore } from '../../stores/timelineEditingStore';
import { trackStore } from '../../stores/trackStore';
import { initTrackSelectionVisibility } from '../initTrackSelectionVisibility';
import { setShowHiddenTracks } from '../timelineEditing/setShowHiddenTracks';
import { selectTrack } from '../toggleTrackState/selectTrack';

const tracks = (hiddenIds: string[] = []) =>
    ['a', 'b', 'c'].map((id) => TrackDummy.create({ id, hidden: hiddenIds.includes(id) }));

const setProject = (list: ReturnType<typeof tracks>, selectedTrackId: string | null) =>
    trackStore.set({ tracks: list, selectedTrackId });

const hide = (id: string) =>
    trackStore.set({
        ...trackStore.value!,
        tracks: trackStore.value!.tracks.map((track) => (track.id === id ? { ...track, hidden: true } : track)),
    });

describe('initTrackSelectionVisibility', () => {
    let stop: () => void;

    beforeEach(() => {
        injectDependencies(selectTrack, { eventBus: { emit: async () => {} } });
        timelineEditingStore.set(defaultTimelineEditingState);
        trackStore.set({ tracks: [], selectedTrackId: null });
        stop = initTrackSelectionVisibility();
    });

    afterEach(() => {
        stop();
        timelineEditingStore.set(defaultTimelineEditingState);
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('moves the selection to the next shown track when the selected track is hidden', () => {
        setProject(tracks(), 'a');

        hide('a');

        expect(trackStore.value?.selectedTrackId).toBe('b');
    });

    it('skips a hidden neighbour', () => {
        setProject(tracks(['b']), 'a');

        hide('a');

        expect(trackStore.value?.selectedTrackId).toBe('c');
    });

    it('moves to the previous shown track when the hidden one was last', () => {
        setProject(tracks(), 'c');

        hide('c');

        expect(trackStore.value?.selectedTrackId).toBe('b');
    });

    it('clears the selection when no track is shown', () => {
        setProject(tracks(['a', 'c']), 'b');

        hide('b');

        expect(trackStore.value?.selectedTrackId).toBeNull();
    });

    it('moves a selection off a folder hidden above it', () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'folder', kind: 'folder' }),
                TrackDummy.create({ id: 'child', parentId: 'folder' }),
                TrackDummy.create({ id: 'other' }),
            ],
            selectedTrackId: 'child',
        });

        hide('folder');

        expect(trackStore.value?.selectedTrackId).toBe('other');
    });

    it('skips a child of a collapsed folder for the next drawn row', () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'folder', kind: 'folder', collapsed: true }),
                TrackDummy.create({ id: 'a' }),
                TrackDummy.create({ id: 'child', parentId: 'folder' }),
                TrackDummy.create({ id: 'z' }),
            ],
            selectedTrackId: 'a',
        });

        hide('a');

        expect(trackStore.value?.selectedTrackId).toBe('z');
    });

    it('selects nothing when the only other track is the master', () => {
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'a' }), TrackDummy.create({ id: 'master', kind: 'master' })],
            selectedTrackId: 'a',
        });

        hide('a');

        expect(trackStore.value?.selectedTrackId).toBeNull();
    });

    it('moves a hidden selection when hidden tracks stop being shown', () => {
        timelineEditingStore.set({ ...defaultTimelineEditingState, showHiddenTracks: true });
        setProject(tracks(['a']), 'a');
        expect(trackStore.value?.selectedTrackId).toBe('a');

        setShowHiddenTracks(false);

        expect(trackStore.value?.selectedTrackId).toBe('b');
    });

    it('leaves a hidden selection alone while hidden tracks are shown', () => {
        timelineEditingStore.set({ ...defaultTimelineEditingState, showHiddenTracks: true });
        setProject(tracks(), 'a');

        hide('a');

        expect(trackStore.value?.selectedTrackId).toBe('a');
    });

    it('leaves a shown selection alone', () => {
        setProject(tracks(), 'b');

        hide('a');

        expect(trackStore.value?.selectedTrackId).toBe('b');
    });

    it('records no undo entry and leaves Track.hidden as written', () => {
        const before = undoHistoryStore.value?.past.length ?? 0;
        setProject(tracks(), 'a');

        hide('a');

        expect(undoHistoryStore.value?.past.length ?? 0).toBe(before);
        expect(trackStore.value?.tracks.find((track) => track.id === 'a')?.hidden).toBe(true);
    });
});
