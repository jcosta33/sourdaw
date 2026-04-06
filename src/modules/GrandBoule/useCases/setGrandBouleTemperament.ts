/**
 * Set the historical temperament for the Grand Boule piano (spec §4).
 *
 * Updates the store and forwards to the engine. Active voices will use the
 * new temperament on their next note-on — already-sounding voices keep their
 * current tuning until re-triggered.
 */

import { grandBouleStore, type TemperamentIndex } from '../stores/grandBouleStore';
import { resolveGrandBouleEngine } from './resolveGrandBouleEngine';

type SetGrandBouleTemperamentInput = {
    deviceId: string;
    temperament: TemperamentIndex;
};

export const setGrandBouleTemperament = (input: SetGrandBouleTemperamentInput): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }

    grandBouleStore.set({
        ...state,
        temperament: input.temperament,
    });

    const engine = resolveGrandBouleEngine({ deviceId: input.deviceId });
    engine.setTemperament({ index: input.temperament });
};
