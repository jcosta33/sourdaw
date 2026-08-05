import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markerStore } from '#/modules/Arrangement/stores';

import { addMarkers } from '../addMarkers';

afterEach(() => {
    markerStore.set({ markers: [], sections: [] });
});

describe('addMarkers', () => {
    beforeEach(() => {
        markerStore.set({ markers: [], sections: [] });
    });

    it('adds markers with default color when not specified', () => {
        addMarkers([{ beat: 0, name: 'Start' }]);
        const state = markerStore.value!;
        expect(state.markers).toHaveLength(1);
        expect(state.markers[0]?.beat).toBe(0);
        expect(state.markers[0]?.name).toBe('Start');
        expect(state.markers[0]?.color).toBe('oklch(0.38 0.08 270)');
    });

    it('uses the provided color when specified', () => {
        addMarkers([{ beat: 16, name: 'Chorus', color: '#ff0000' }]);
        expect(markerStore.value!.markers[0]?.color).toBe('#ff0000');
    });

    it('appends to existing markers without clearing them', () => {
        addMarkers([{ beat: 0, name: 'A' }]);
        addMarkers([{ beat: 32, name: 'B' }]);
        expect(markerStore.value!.markers.map((m) => m.name)).toEqual(['A', 'B']);
    });

    it('preserves existing sections', () => {
        markerStore.set({ markers: [], sections: [{ id: 's1', startBeat: 0, endBeat: 8, name: 'S', color: '#abc' }] });
        addMarkers([{ beat: 0, name: 'M' }]);
        expect(markerStore.value!.sections).toHaveLength(1);
    });
});
