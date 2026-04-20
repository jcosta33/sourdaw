import { describe, it, expect, beforeEach } from 'vitest';

import { tempoMapStore } from '../tempoMapStore';

describe('tempoMapStore', () => {
    beforeEach(() => {
        tempoMapStore.set({ changes: [] });
    });

    it('should have an initial empty state', () => {
        expect(tempoMapStore.value).toEqual({ changes: [] });
    });

    it('should store tempo changes', () => {
        const change = { id: '1', beat: 4, tempo: 140, curve: 'linear' as const };
        tempoMapStore.set({ changes: [change] });

        expect(tempoMapStore.value?.changes).toHaveLength(1);
        expect(tempoMapStore.value?.changes[0]).toEqual(change);
    });

    it('should update state', () => {
        tempoMapStore.update((state) => ({
            ...state,
            changes: [...(state?.changes ?? []), { id: '2', beat: 8, tempo: 120, curve: 'instant' as const }],
        }));

        expect(tempoMapStore.value?.changes).toHaveLength(1);
        expect(tempoMapStore.value?.changes[0]?.beat).toBe(8);
    });
});
