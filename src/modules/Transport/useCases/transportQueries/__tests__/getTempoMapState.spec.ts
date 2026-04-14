import { describe, it, expect, beforeEach } from 'vitest';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { getTempoMapState } from '../getTempoMapState';

describe('getTempoMapState', () => {
    beforeEach(() => {
        tempoMapStore.set({ changes: [] });
    });

    it('should return the current tempo map store snapshot', () => {
        const next = { changes: [{ id: 't1', beat: 0, tempo: 140, curve: 'instant' as const }] };
        tempoMapStore.set(next);
        expect(getTempoMapState()).toBe(next);
    });

    it('should return null when the store is not initialized', () => {
        tempoMapStore.set(null);
        expect(getTempoMapState()).toBeNull();
    });
});
