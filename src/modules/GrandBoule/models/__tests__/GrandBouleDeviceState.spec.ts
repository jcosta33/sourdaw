import { describe, expect, it } from 'vitest';

import {
    GRAND_BOULE_DEVICE_STATE_VERSION,
    fromGrandBouleDeviceState,
    readGrandBouleMorphState,
    toGrandBouleDeviceState,
} from '../GrandBouleDeviceState';
import { createDefaultMorphState } from '../GrandBouleMorphState';

const savedMorph = {
    modelA: 'mellow-grand',
    modelB: 'singing-grand',
    morphPosition: 0.73,
    layerBalance: -0.25,
    enabled: true,
};

describe('GrandBouleDeviceState', () => {
    it('round-trips the complete versioned voicing state', () => {
        const state = toGrandBouleDeviceState(savedMorph);

        expect(state).toEqual({ version: GRAND_BOULE_DEVICE_STATE_VERSION, data: savedMorph });
        expect(fromGrandBouleDeviceState(state)).toEqual(savedMorph);
    });

    it('rejects removed aliases and restores the neutral default for invalid saved state', () => {
        expect(
            fromGrandBouleDeviceState({
                version: GRAND_BOULE_DEVICE_STATE_VERSION,
                data: { ...savedMorph, modelA: 'steinway-d' },
            })
        ).toBeNull();
        expect(readGrandBouleMorphState({ version: 999, data: savedMorph })).toEqual(createDefaultMorphState());
    });
});
