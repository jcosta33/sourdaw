import { describe, it, expect, beforeEach } from 'vitest';

import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';

import { snapToGrid } from '../snapToGrid';

describe('snapToGrid', () => {
    beforeEach(() => {
        preferencesStore.set({
            ...defaultPreferences,
            snapToGrid: true,
            gridSubdivision: '1/4',
        });
    });

    it('should return the beat unchanged when snap-to-grid is disabled', () => {
        preferencesStore.set({ ...defaultPreferences, snapToGrid: false });
        expect(snapToGrid(3.777)).toBe(3.777);
    });

    it('should return the beat unchanged when grid subdivision resolves to zero', () => {
        preferencesStore.set({ ...defaultPreferences, snapToGrid: true, gridSubdivision: 'off' });
        expect(snapToGrid(2.5)).toBe(2.5);
    });

    it('should snap to the active grid when snap-to-grid is enabled', () => {
        expect(snapToGrid(1.1)).toBeCloseTo(1.0);
        expect(snapToGrid(1.2)).toBeCloseTo(1.25);
    });
});
