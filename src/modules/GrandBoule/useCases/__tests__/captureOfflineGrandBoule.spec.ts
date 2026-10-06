import { beforeEach, describe, expect, it } from 'vitest';

import {
    type GrandBoulePersistedState,
    type TemperamentIndex,
    toGrandBouleDeviceState,
} from '../../models/GrandBouleDeviceState';
import { type GrandBouleMorphState } from '../../models/GrandBouleMorphState';
import { type GrandBoulePresetParameters, createNeutralPresetParameters } from '../../models/GrandBoulePreset';
import {
    createDefaultGrandBouleState,
    createGrandBouleStore,
    resetGrandBouleStores,
} from '../../stores/grandBouleStore';
import { captureOfflineGrandBoule } from '../captureOfflineGrandBoule';

const NEUTRAL_PARAMETERS = createNeutralPresetParameters();

const PERSISTED_MORPH: GrandBouleMorphState = {
    modelA: 'mellow-grand',
    modelB: 'singing-grand',
    morphPosition: 0.4,
    layerBalance: 0.2,
    enabled: true,
};

function persistedState(
    temperament: TemperamentIndex,
    parameters: GrandBoulePresetParameters
): GrandBoulePersistedState {
    return { morph: PERSISTED_MORPH, temperament, parameters };
}

describe('captureOfflineGrandBoule', () => {
    beforeEach(() => {
        resetGrandBouleStores();
    });

    it('captures the persisted voicing when no store exists', () => {
        // An export before any engine load must still play the project's
        // persisted tuning: the chunk is the only carrier that exists.
        const parameters = { hammerHardness: 0.4, velocityCurve: 0.85, stereoWidth: 0.7, toneTilt: 0.35 };

        const captured = captureOfflineGrandBoule({
            deviceId: 'grand-boule-never-loaded',
            deviceState: toGrandBouleDeviceState(persistedState(1, parameters)),
            calibration: null,
        });

        expect(captured.voicing).toEqual({ temperament: 1, parameters });
    });

    it('prefers the live store voicing over the persisted chunk', () => {
        const storeParameters = { hammerHardness: -0.2, velocityCurve: 1.4, stereoWidth: 0.9, toneTilt: -0.5 };
        createGrandBouleStore('grand-boule-live').set({
            ...createDefaultGrandBouleState(),
            temperament: 2,
            parameters: storeParameters,
        });

        const captured = captureOfflineGrandBoule({
            deviceId: 'grand-boule-live',
            deviceState: toGrandBouleDeviceState(
                persistedState(1, { hammerHardness: 0.4, velocityCurve: 0.85, stereoWidth: 0.7, toneTilt: 0.35 })
            ),
            calibration: null,
        });

        expect(captured.voicing).toEqual({ temperament: 2, parameters: storeParameters });
    });

    it('falls back to the default voicing when neither store nor chunk carries one', () => {
        const captured = captureOfflineGrandBoule({
            deviceId: 'grand-boule-pristine',
            deviceState: undefined,
            calibration: null,
        });

        expect(captured.voicing).toEqual({ temperament: 0, parameters: NEUTRAL_PARAMETERS });
    });
});
