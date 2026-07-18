import { beforeEach, describe, expect, it } from 'vitest';

import { clipSelectionStore, defaultClipSelectionState } from '../../../stores/clipSelectionStore';
import { clearClipSelection } from '../clearClipSelection';
import { selectAllClips } from '../selectAllClips';
import { selectClip } from '../selectClip';
import { selectClipWithFocus } from '../selectClipWithFocus';
import { setClipSelection } from '../setClipSelection';
import { setMarqueeSelection } from '../setMarqueeSelection';
import { toggleClipInSelection } from '../toggleClipInSelection';

describe('clip selection use cases', () => {
    beforeEach(() => {
        clipSelectionStore.set({ ...defaultClipSelectionState });
    });

    it('selectClip sets the focused clip and leaves the multi-selection untouched', () => {
        clipSelectionStore.set({ selectedClipId: null, selectedClipIds: ['keep'], marqueeSelection: null });

        selectClip('clip-1');

        expect(clipSelectionStore.value).toEqual({
            selectedClipId: 'clip-1',
            selectedClipIds: ['keep'],
            marqueeSelection: null,
        });
    });

    it('selectClipWithFocus makes the clip the sole focused selection', () => {
        selectClipWithFocus('clip-1');

        expect(clipSelectionStore.value?.selectedClipId).toBe('clip-1');
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['clip-1']);
    });

    it('setClipSelection sets the selection and focuses the first clip', () => {
        setClipSelection(['clip-1', 'clip-2']);

        expect(clipSelectionStore.value?.selectedClipId).toBe('clip-1');
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['clip-1', 'clip-2']);
    });

    it('setClipSelection clears the focused clip when the selection is empty', () => {
        setClipSelection([]);

        expect(clipSelectionStore.value?.selectedClipId).toBeNull();
        expect(clipSelectionStore.value?.selectedClipIds).toEqual([]);
    });

    it('selectAllClips selects every clip id and drops the single focus', () => {
        selectAllClips(() => ['a', 'b']);

        expect(clipSelectionStore.value?.selectedClipId).toBeNull();
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['a', 'b']);
    });

    it('clearClipSelection clears the focused clip and the whole selection', () => {
        clipSelectionStore.set({ selectedClipId: 'x', selectedClipIds: ['x', 'y'], marqueeSelection: null });

        clearClipSelection();

        expect(clipSelectionStore.value?.selectedClipId).toBeNull();
        expect(clipSelectionStore.value?.selectedClipIds).toEqual([]);
    });

    it('toggleClipInSelection adds a clip that was not part of the selection', () => {
        clipSelectionStore.set({ selectedClipId: null, selectedClipIds: [], marqueeSelection: null });

        toggleClipInSelection('clip-1');

        expect(clipSelectionStore.value?.selectedClipId).toBe('clip-1');
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['clip-1']);
    });

    it('toggleClipInSelection removes a clip that was already selected', () => {
        clipSelectionStore.set({ selectedClipId: null, selectedClipIds: ['clip-1', 'clip-2'], marqueeSelection: null });

        toggleClipInSelection('clip-1');

        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['clip-2']);
    });

    it('setMarqueeSelection stores the marquee range and preserves clip selection', () => {
        clipSelectionStore.set({ selectedClipId: 'c', selectedClipIds: ['c'], marqueeSelection: null });

        setMarqueeSelection({ startBeat: 1, endBeat: 4, trackIds: ['t1'] });

        expect(clipSelectionStore.value?.marqueeSelection).toEqual({ startBeat: 1, endBeat: 4, trackIds: ['t1'] });
        expect(clipSelectionStore.value?.selectedClipId).toBe('c');
    });

    it('setMarqueeSelection clears the marquee when passed null', () => {
        clipSelectionStore.set({
            selectedClipId: null,
            selectedClipIds: [],
            marqueeSelection: { startBeat: 0, endBeat: 2, trackIds: [] },
        });

        setMarqueeSelection(null);

        expect(clipSelectionStore.value?.marqueeSelection).toBeNull();
    });

    it('toggleClipInSelection does not update when the selection state is missing', () => {
        clipSelectionStore.set(null);

        toggleClipInSelection('clip-1');

        expect(clipSelectionStore.value).toBeNull();
    });

    it('setMarqueeSelection does not update when the selection state is missing', () => {
        clipSelectionStore.set(null);

        setMarqueeSelection({ startBeat: 0, endBeat: 2, trackIds: [] });

        expect(clipSelectionStore.value).toBeNull();
    });
});
