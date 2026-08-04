import { describe, it, expect, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { transportStore } from '../../../stores/transportStore';
import { getTempoAtPlayhead } from '../getTempoAtPlayhead';

describe('getTempoAtPlayhead', () => {
    beforeEach(() => {
        // Base tempo deliberately unequal to every fixture map tempo, so a query
        // that read `transport.tempo` instead of the map would be visible.
        transportStore.set({ ...defaultTransportState, tempo: 110, playheadPosition: 0 });
        tempoMapStore.set({ changes: [] });
    });

    it('reports the tempo-map value when a change sits at beat 0', () => {
        tempoMapStore.set({ changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] });

        expect(getTempoAtPlayhead()).toBe(90);
    });

    it('follows the playhead across tempo changes', () => {
        tempoMapStore.set({
            changes: [
                { id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' },
                { id: 'tc-4', beat: 4, tempo: 140, curve: 'instant' },
            ],
        });
        transportStore.set({ ...defaultTransportState, tempo: 110, playheadPosition: 8 });

        expect(getTempoAtPlayhead()).toBe(140);
    });

    it('reports the first change when the playhead sits before every change', () => {
        tempoMapStore.set({ changes: [{ id: 'tc-16', beat: 16, tempo: 100, curve: 'instant' }] });

        expect(getTempoAtPlayhead()).toBe(100);
    });

    it('reports the transport base tempo when there is no tempo map', () => {
        expect(getTempoAtPlayhead()).toBe(110);
    });

    it('falls back to the default tempo when the transport store is empty', () => {
        transportStore.set(null);

        expect(getTempoAtPlayhead()).toBe(defaultTransportState.tempo);
    });
});
