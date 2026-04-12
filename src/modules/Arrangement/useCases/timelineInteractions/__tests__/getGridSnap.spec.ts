import { describe, it, expect, beforeEach } from 'vitest';

import { preferencesStore } from '#/modules/Workspace/stores';
import { defaultPreferences } from '#/modules/Workspace/useCases/workspaceQueries/helpers';

import { getGridSnap } from '../snapToGrid';

describe('getGridSnap', () => {
    beforeEach(() => {
        preferencesStore.set({
            ...defaultPreferences,
            snapToGrid: true,
            gridSubdivision: '1/4',
        });
    });

    it('should return the snap interval in beats when snap-to-grid is on', () => {
        expect(getGridSnap()).toBeCloseTo(0.25);
    });

    it('should return zero when snap-to-grid is off', () => {
        preferencesStore.set({ ...defaultPreferences, snapToGrid: false });
        expect(getGridSnap()).toBe(0);
    });

    it('should return zero when subdivision is off', () => {
        preferencesStore.set({ ...defaultPreferences, snapToGrid: true, gridSubdivision: 'off' });
        expect(getGridSnap()).toBe(0);
    });
});
