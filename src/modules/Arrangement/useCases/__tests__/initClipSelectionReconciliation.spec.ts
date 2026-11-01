import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTrack, type Clip, type Track } from '../../models/Track';
import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';
import { trackStore, type TrackStoreState } from '../../stores/trackStore';
import { initClipSelectionReconciliation } from '../initClipSelectionReconciliation';

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
        color: '#22c55e',
        locked: false,
        muted: false,
    };
}

function makeTrack(id: string, clipIds: string[]): Track {
    return {
        ...createTrack({
            id,
            kind: 'audio',
            name: id,
            initialDeviceId: `${id}-device`,
            initialAlternativeId: `${id}-alternative`,
        }),
        clips: clipIds.map((clipId) => makeClip(clipId, id)),
    };
}

function setProject(state: Partial<TrackStoreState> & Pick<TrackStoreState, 'tracks'>): void {
    trackStore.set({ selectedTrackId: null, ...state });
}

describe('initClipSelectionReconciliation', () => {
    let stop: () => void;

    beforeEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        clipSelectionStore.set(defaultClipSelectionState);
        stop = initClipSelectionReconciliation();
    });

    afterEach(() => {
        stop();
        trackStore.set({ tracks: [], selectedTrackId: null });
        clipSelectionStore.set(defaultClipSelectionState);
    });

    it('drops a removed clip and makes the survivor of a two-clip selection the primary', () => {
        setProject({ tracks: [makeTrack('t1', ['a', 'b'])] });
        clipSelectionStore.set({ selectedClipId: null, selectedClipIds: ['a', 'b'], marqueeSelection: null });

        setProject({ tracks: [makeTrack('t1', ['a'])] });

        expect(clipSelectionStore.value).toEqual({
            selectedClipId: 'a',
            selectedClipIds: ['a'],
            marqueeSelection: null,
        });
    });

    it('drops the removed primary of a three-clip selection and leaves no primary', () => {
        setProject({ tracks: [makeTrack('t1', ['a', 'b', 'c'])] });
        clipSelectionStore.set({ selectedClipId: 'b', selectedClipIds: ['a', 'b', 'c'], marqueeSelection: null });

        setProject({ tracks: [makeTrack('t1', ['a', 'c'])] });

        expect(clipSelectionStore.value).toEqual({
            selectedClipId: null,
            selectedClipIds: ['a', 'c'],
            marqueeSelection: null,
        });
    });

    it('keeps the primary when a non-primary clip of a three-clip selection is removed', () => {
        setProject({ tracks: [makeTrack('t1', ['a', 'b', 'c'])] });
        clipSelectionStore.set({ selectedClipId: 'a', selectedClipIds: ['a', 'b', 'c'], marqueeSelection: null });

        setProject({ tracks: [makeTrack('t1', ['a', 'b'])] });

        expect(clipSelectionStore.value).toEqual({
            selectedClipId: 'a',
            selectedClipIds: ['a', 'b'],
            marqueeSelection: null,
        });
    });

    it('empties the selection and its primary when every selected clip is removed', () => {
        setProject({ tracks: [makeTrack('t1', ['a', 'b']), makeTrack('t2', ['c'])] });
        clipSelectionStore.set({ selectedClipId: 'a', selectedClipIds: ['a', 'b'], marqueeSelection: null });

        setProject({ tracks: [makeTrack('t2', ['c'])] });

        expect(clipSelectionStore.value).toEqual({
            selectedClipId: null,
            selectedClipIds: [],
            marqueeSelection: null,
        });
    });

    it('drops the clips of a deleted track and keeps the clips of the tracks that remain', () => {
        setProject({ tracks: [makeTrack('t1', ['a']), makeTrack('t2', ['b', 'c'])] });
        clipSelectionStore.set({ selectedClipId: null, selectedClipIds: ['a', 'b', 'c'], marqueeSelection: null });

        setProject({ tracks: [makeTrack('t2', ['b', 'c'])] });

        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['b', 'c']);
        expect(clipSelectionStore.value?.selectedClipId).toBeNull();
    });

    it('writes nothing when a track change removes no selected clip', () => {
        setProject({ tracks: [makeTrack('t1', ['a', 'b']), makeTrack('t2', ['c'])] });
        clipSelectionStore.set({ selectedClipId: 'a', selectedClipIds: ['a', 'b'], marqueeSelection: null });
        const before = clipSelectionStore.value;
        let writes = 0;
        const unsubscribe = clipSelectionStore.subscribe(() => {
            writes += 1;
        });

        // The unselected clip leaves; the selected ones stay.
        setProject({ tracks: [makeTrack('t1', ['a', 'b'])] });
        unsubscribe();

        expect(writes).toBe(0);
        expect(clipSelectionStore.value).toBe(before);
    });

    it('writes nothing for an empty selection', () => {
        setProject({ tracks: [makeTrack('t1', ['a'])] });
        const before = clipSelectionStore.value;

        setProject({ tracks: [] });

        expect(clipSelectionStore.value).toBe(before);
    });

    it('leaves the marquee selection alone while pruning', () => {
        const marqueeSelection = { startBeat: 1, endBeat: 5, trackIds: ['t1'] };
        setProject({ tracks: [makeTrack('t1', ['a', 'b'])] });
        clipSelectionStore.set({ selectedClipId: null, selectedClipIds: ['a', 'b'], marqueeSelection });

        setProject({ tracks: [makeTrack('t1', ['a'])] });

        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['a']);
        expect(clipSelectionStore.value?.marqueeSelection).toBe(marqueeSelection);
    });

    it('clears a primary naming a removed clip even when the id list holds only survivors', () => {
        setProject({ tracks: [makeTrack('t1', ['a', 'b', 'c'])] });
        clipSelectionStore.set({ selectedClipId: 'b', selectedClipIds: ['a', 'c'], marqueeSelection: null });

        setProject({ tracks: [makeTrack('t1', ['a', 'c'])] });

        expect(clipSelectionStore.value).toEqual({
            selectedClipId: null,
            selectedClipIds: ['a', 'c'],
            marqueeSelection: null,
        });
    });

    it('keeps a selected ghost clip, which lives beside the tracks', () => {
        const ghost = { ...makeClip('ghost-1', 't1'), isGhost: true };
        setProject({ tracks: [makeTrack('t1', ['a'])], ghostClips: [ghost] });
        clipSelectionStore.set({ selectedClipId: null, selectedClipIds: ['a', 'ghost-1'], marqueeSelection: null });

        setProject({ tracks: [makeTrack('t1', ['a'])], ghostClips: [ghost] });
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['a', 'ghost-1']);

        setProject({ tracks: [makeTrack('t1', ['a'])], ghostClips: [] });
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['a']);
        expect(clipSelectionStore.value?.selectedClipId).toBe('a');
    });

    it('keeps a selected clip of an inactive alternative, which its variation lane draws', () => {
        const base = makeTrack('t1', ['a']);
        const withLanes: Track = {
            ...base,
            alternatives: [
                { id: base.activeAlternativeId, name: 'Alternative 1', clips: [] },
                { id: 't1-alt-2', name: 'Alternative 2', clips: [makeClip('lane-1', 't1')] },
            ],
        };
        setProject({ tracks: [withLanes] });
        clipSelectionStore.set({ selectedClipId: null, selectedClipIds: ['lane-1', 'a'], marqueeSelection: null });

        setProject({ tracks: [withLanes], selectedTrackId: 't1' });

        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['lane-1', 'a']);
    });

    it("drops a removed clip that only the active alternative's stored copy still holds", () => {
        const base = makeTrack('t1', ['a', 'b']);
        const staleActiveCopy: Track = {
            ...base,
            clips: [makeClip('a', 't1')],
            alternatives: [{ id: base.activeAlternativeId, name: 'Alternative 1', clips: base.clips }],
        };
        setProject({ tracks: [base] });
        clipSelectionStore.set({ selectedClipId: null, selectedClipIds: ['a', 'b'], marqueeSelection: null });

        setProject({ tracks: [staleActiveCopy] });

        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['a']);
        expect(clipSelectionStore.value?.selectedClipId).toBe('a');
    });

    it('stops reconciling once unsubscribed', () => {
        setProject({ tracks: [makeTrack('t1', ['a', 'b'])] });
        clipSelectionStore.set({ selectedClipId: null, selectedClipIds: ['a', 'b'], marqueeSelection: null });
        stop();

        setProject({ tracks: [] });

        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['a', 'b']);
    });
});
