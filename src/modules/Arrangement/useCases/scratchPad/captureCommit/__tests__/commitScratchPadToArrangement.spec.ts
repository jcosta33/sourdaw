import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markerStore, type MarkerStoreState } from '../../../../stores/markerStore';
import { scratchPadStore } from '../../../../stores/scratchPadStore';
import { commitScratchPadToArrangement } from '../commitScratchPadToArrangement';

describe('commitScratchPadToArrangement', () => {
    beforeEach(() => {
        scratchPadStore.set({ sections: [] });
        markerStore.set({ markers: [], sections: [] });
    });

    afterEach(() => {
        scratchPadStore.set({ sections: [] });
        markerStore.set({ markers: [], sections: [] });
    });

    it('commits scratch-pad sections to the marker store sorted by their pad order', () => {
        scratchPadStore.set({
            sections: [
                { id: 's-b', startBeat: 8, endBeat: 16, name: 'B', color: '#00f', order: 1 },
                { id: 's-a', startBeat: 0, endBeat: 8, name: 'A', color: '#f00', order: 0 },
            ],
        });

        commitScratchPadToArrangement();

        const committed = markerStore.value?.sections ?? [];
        expect(committed.map((section) => section.name)).toEqual(['A', 'B']);
        expect(committed.map((section) => [section.startBeat, section.endBeat, section.color])).toEqual([
            [0, 8, '#f00'],
            [8, 16, '#00f'],
        ]);
        // Committed sections get fresh ids namespaced away from the scratch pad.
        expect(committed.every((section) => section.id.startsWith('section-committed-'))).toBe(true);
    });

    it('is a no-op when the scratch pad has no sections', () => {
        scratchPadStore.set({ sections: [] });
        const before = markerStore.value as MarkerStoreState;

        commitScratchPadToArrangement();

        expect(markerStore.value).toBe(before);
    });

    it('is a no-op when the scratch-pad store holds no state', () => {
        scratchPadStore.set({
            sections: [{ id: 's-a', startBeat: 0, endBeat: 8, name: 'A', color: '#f00', order: 0 }],
        });
        scratchPadStore.clear();
        const before = markerStore.value as MarkerStoreState;

        commitScratchPadToArrangement();

        expect(markerStore.value).toBe(before);
    });

    it('is a no-op when the marker store holds no state', () => {
        scratchPadStore.set({
            sections: [{ id: 's-a', startBeat: 0, endBeat: 8, name: 'A', color: '#f00', order: 0 }],
        });
        markerStore.clear();

        commitScratchPadToArrangement();

        expect(markerStore.value).toBeNull();
    });
});
