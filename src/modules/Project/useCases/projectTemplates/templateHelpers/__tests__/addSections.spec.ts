import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markerStore } from '#/modules/Arrangement/stores';

import { addSections } from '../addSections';

afterEach(() => {
    markerStore.set({ markers: [], sections: [] });
});

describe('addSections', () => {
    beforeEach(() => {
        markerStore.set({ markers: [], sections: [] });
    });

    it('adds sections with default color when not specified', () => {
        addSections([{ startBeat: 0, endBeat: 16, name: 'Verse' }]);
        const state = markerStore.value!;
        expect(state.sections).toHaveLength(1);
        expect(state.sections[0]?.name).toBe('Verse');
        expect(state.sections[0]?.color).toBe('oklch(0.40 0.07 200)');
    });

    it('uses the provided color when specified', () => {
        addSections([{ startBeat: 0, endBeat: 8, name: 'Intro', color: '#00ff00' }]);
        expect(markerStore.value!.sections[0]?.color).toBe('#00ff00');
    });

    it('appends to existing sections without clearing them', () => {
        addSections([{ startBeat: 0, endBeat: 8, name: 'A' }]);
        addSections([{ startBeat: 8, endBeat: 16, name: 'B' }]);
        expect(markerStore.value!.sections.map((s) => s.name)).toEqual(['A', 'B']);
    });

    it('preserves existing markers', () => {
        markerStore.set({
            markers: [{ id: 'm1', beat: 0, name: 'M', color: '#abc' }],
            sections: [],
        });
        addSections([{ startBeat: 0, endBeat: 8, name: 'S' }]);
        expect(markerStore.value!.markers).toHaveLength(1);
    });
});
