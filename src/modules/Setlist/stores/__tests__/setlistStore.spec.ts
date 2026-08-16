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
        });
    });

    it('should have the documented default state', () => {
        expect(setlistStore.value).toEqual({
            name: 'Untitled Setlist',
            items: [],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
        });
    });

    it('should update state', () => {
        setlistStore.update((state) => ({ ...state!, name: 'Tour 2026' }));
        expect(setlistStore.value?.name).toBe('Tour 2026');
    });

    it('should replace the whole state on set, not merge it', () => {
        setlistStore.set({
            name: 'Reset',
            items: [],
            currentIndex: 0,
            autoAdvance: true,
            countInBars: 4,
        });

        expect(setlistStore.value).toEqual({
            name: 'Reset',
            items: [],
            currentIndex: 0,
            autoAdvance: true,
            countInBars: 4,
        });
    });

    it('should append an item via update without touching unrelated fields', () => {
        const song = {
            id: 'sli-1',
            name: 'Opener',
            projectPath: null,
            bpm: null,
            timeSignature: null,
            estimatedDuration: 180,
            notes: '',
            programChange: null,
            color: 'oklch(0.42 0.08 200)',
            autoStop: true,
            gapSeconds: 2,
            markers: [],
        };

        setlistStore.update((state) => ({ ...state!, items: [...state!.items, song] }));

        expect(setlistStore.value?.items).toEqual([song]);
        expect(setlistStore.value?.name).toBe('Untitled Setlist');
    });
});
