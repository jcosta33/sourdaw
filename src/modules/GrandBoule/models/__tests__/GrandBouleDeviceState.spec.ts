import { describe, expect, it } from 'vitest';

import {
    GRAND_BOULE_DEVICE_STATE_VERSION,
    fromGrandBouleDeviceState,
    readGrandBouleDeviceState,
    toGrandBouleDeviceState,
} from '../GrandBouleDeviceState';
import { createDefaultMorphState } from '../GrandBouleMorphState';
import { createNeutralPresetParameters } from '../GrandBoulePreset';

const savedState = {
    morph: {
        modelA: 'mellow-grand',
        modelB: 'singing-grand',
        morphPosition: 0.73,
        layerBalance: -0.25,
        enabled: true,
    },
    temperament: 1 as const,
    parameters: { hammerHardness: 0.4, velocityCurve: 0.85, stereoWidth: 0.7, toneTilt: 0.35 },
};

const savedData = { ...savedState.morph, temperament: savedState.temperament, ...savedState.parameters };

describe('GrandBouleDeviceState', () => {
    it('round-trips the complete versioned voicing state', () => {
        const state = toGrandBouleDeviceState(savedState);

        expect(state).toEqual({ version: GRAND_BOULE_DEVICE_STATE_VERSION, data: savedData });
        expect(fromGrandBouleDeviceState(state)).toEqual(savedState);
    });

    it('defaults the tuning and voicing leaves a pre-#4727 chunk does not carry', () => {
        const morphOnly = {
            version: GRAND_BOULE_DEVICE_STATE_VERSION,
            data: savedState.morph,
        };

        expect(fromGrandBouleDeviceState(morphOnly)).toEqual({
            morph: savedState.morph,
            temperament: 0,
            parameters: createNeutralPresetParameters(),
        });
    });

    // A `null` leaf is present, not absent: the temperament check only folds
    // `undefined`, so `null` is a present value outside 0..5 and rejects the
    // chunk like any other corruption.
    it('rejects a chunk whose temperament leaf is null', () => {
        expect(
            fromGrandBouleDeviceState({
                version: GRAND_BOULE_DEVICE_STATE_VERSION,
                data: { ...savedData, temperament: null },
            })
        ).toBeNull();
    });

    // The voicing leaves fold through `??`, so `null` lands on the neutral
    // default exactly like an absent leaf instead of rejecting the chunk.
    it('folds null voicing leaves to the neutral defaults on decode', () => {
        expect(
            fromGrandBouleDeviceState({
                version: GRAND_BOULE_DEVICE_STATE_VERSION,
                data: {
                    ...savedData,
                    hammerHardness: null,
                    velocityCurve: null,
                    stereoWidth: null,
                    toneTilt: null,
                },
            })
        ).toEqual({
            morph: savedState.morph,
            temperament: savedState.temperament,
            parameters: createNeutralPresetParameters(),
        });
    });

    it('rejects removed aliases and restores the neutral default for invalid saved state', () => {
        expect(
            fromGrandBouleDeviceState({
                version: GRAND_BOULE_DEVICE_STATE_VERSION,
                data: { ...savedData, modelA: 'steinway-d' },
            })
        ).toBeNull();
        expect(
            fromGrandBouleDeviceState({
                version: GRAND_BOULE_DEVICE_STATE_VERSION,
                data: { ...savedData, temperament: 6 },
            })
        ).toBeNull();
        expect(
            fromGrandBouleDeviceState({
                version: GRAND_BOULE_DEVICE_STATE_VERSION,
                data: { ...savedData, stereoWidth: 1.4 },
            })
        ).toBeNull();
        expect(readGrandBouleDeviceState({ version: 999, data: savedData })).toEqual({
            morph: createDefaultMorphState(),
            temperament: 0,
            parameters: createNeutralPresetParameters(),
        });
    });
});
