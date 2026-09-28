import { type Store } from '#/infra/store/types';

import { type GrandBoulePersistedState, type TemperamentIndex } from '../models/GrandBouleDeviceState';
import { type GrandBouleState } from '../stores/grandBouleStore';
/**
 * Set the historical temperament for the Grand Boule piano.
 *
 * Updates the store and forwards to the engine. Active voices will use the
 * new temperament on their next note-on — already-sounding voices keep their
 * current tuning until re-triggered. The pick is committed to project truth
 * through the same undoable device-state action a morph edit rides (#4727),
 * so a reload and an offline render keep the tuning the live piano plays.
 */

import { commitGrandBouleDeviceState } from './commitGrandBouleDeviceState';
import { resolveGrandBouleEngine } from './resolveGrandBouleEngine';

type SetGrandBouleTemperamentInput = {
    deviceId: string;
    temperament: TemperamentIndex;
    store: Store<GrandBouleState>;
};

export function setGrandBouleTemperament(input: SetGrandBouleTemperamentInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }

    input.store.set({
        ...state,
        temperament: input.temperament,
    });

    const engine = resolveGrandBouleEngine({ deviceId: input.deviceId });
    engine.setTemperament({ index: input.temperament });

    const persisted: GrandBoulePersistedState = {
        morph: state.morph,
        temperament: input.temperament,
        parameters: state.parameters,
    };
    commitGrandBouleDeviceState(input.deviceId, persisted);
}
