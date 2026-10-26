import { describe, it, expect, afterEach } from 'vitest';

import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';

import { defaultTransportState } from '../../models/TransportState';
import { preferencesSeededTransportState } from '../preferencesSeededTransportState';

describe('preferencesSeededTransportState', () => {
    afterEach(() => {
        preferencesStore.set(defaultPreferences);
    });

    it('seeds the count-in and pre-roll fields from the Recording preferences', () => {
        preferencesStore.set({ ...defaultPreferences, recordCountIn: 2, preRollEnabled: false, preRollBars: 1 });

        expect(preferencesSeededTransportState()).toEqual({
            ...defaultTransportState,
            countInEnabled: true,
            countInBars: 2,
            preRollEnabled: false,
            preRollBars: 1,
        });
    });

    it('turns the count-in off and keeps the model bar count when the preference is Off', () => {
        preferencesStore.set({ ...defaultPreferences, recordCountIn: 0 });

        const state = preferencesSeededTransportState();
        expect(state.countInEnabled).toBe(false);
        expect(state.countInBars).toBe(defaultTransportState.countInBars);
    });

    it('carries the preference defaults through when the store holds its defaults', () => {
        // The shipped `recordCountIn` default is Off, so the seeded state
        // coincides with the transport model's own defaults: a fresh install
        // keeps the historical no-count-in behavior while the preference is
        // honored for new projects.
        preferencesStore.set(defaultPreferences);

        expect(preferencesSeededTransportState()).toEqual({
            ...defaultTransportState,
            countInEnabled: false,
            countInBars: 1,
            preRollEnabled: false,
            preRollBars: 2,
        });
    });

    it('falls back to the model defaults when the preferences store holds nothing', () => {
        preferencesStore.set(null);

        expect(preferencesSeededTransportState()).toEqual(defaultTransportState);
    });
});
