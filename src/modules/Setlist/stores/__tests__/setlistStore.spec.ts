import { describe, it, expect, beforeEach } from 'vitest';

import { setlistStore } from '../setlistStore';

describe('setlistStore', () => {
    beforeEach(() => {
        setlistStore.set({
            name: 'Untitled Setlist',
            items: [],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 0,
        });
    });

    it('should have initial state', () => {
        expect(setlistStore.value?.items).toHaveLength(0);
        expect(setlistStore.value?.name).toBe('Untitled Setlist');
    });

    it('should update state', () => {
        setlistStore.update((state) => ({ ...state!, name: 'Tour 2026' }));
        expect(setlistStore.value?.name).toBe('Tour 2026');
    });
});
