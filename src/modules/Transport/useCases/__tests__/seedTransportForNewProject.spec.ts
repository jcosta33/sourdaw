import { afterEach, describe, expect, it } from 'vitest';

import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';

import { defaultTransportState } from '../../models/TransportState';
import { transportStore } from '../../stores/transportStore';
import { seedTransportForNewProject } from '../seedTransportForNewProject';

describe('seedTransportForNewProject', () => {
    afterEach(() => {
        preferencesStore.set(defaultPreferences);
        transportStore.set(defaultTransportState);
    });

    it('replaces the whole transport with the preference-seeded new-project state', () => {
        // A transport left behind by the outgoing project: none of it survives.
        transportStore.set({ ...defaultTransportState, tempo: 97, isLooping: true, loopEnd: 12, masterGain: 40 });
        preferencesStore.set({ ...defaultPreferences, recordCountIn: 2, preRollEnabled: false, preRollBars: 1 });

        seedTransportForNewProject();

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            countInEnabled: true,
            countInBars: 2,
            preRollEnabled: false,
            preRollBars: 1,
        });
    });

    it('builds a template or demo transport on the preference seed rather than the model defaults', () => {
        preferencesStore.set({ ...defaultPreferences, recordCountIn: 4, preRollEnabled: true, preRollBars: 4 });

        seedTransportForNewProject({ tempo: 76, loopEnd: 32, isLooping: true });

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            countInEnabled: true,
            countInBars: 4,
            preRollEnabled: true,
            preRollBars: 4,
            tempo: 76,
            loopEnd: 32,
            isLooping: true,
        });
    });
});
