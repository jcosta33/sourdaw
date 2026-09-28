import { type Store } from '#/infra/store/types';

import { type GrandBoulePersistedState } from '../models/GrandBouleDeviceState';
import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';
/**
 * Set the velocity curve exponent for the Grand Boule piano.
 *
 * Controls how MIDI velocity maps to hammer force:
 *   0.5 = compressed (soft touch, higher minimum)
 *   1.0 = linear
 *   2.0 = expanded (requires stronger strikes for forte)
 *
 * The curve rides the persisted device-state chunk (it declares no descriptor
 * parameter), so the settled value commits to project truth through the same
 * undoable action a temperament pick or preset load rides (#4727) — otherwise
 * the chunk only receives it when a later morph edit happens to commit the
 * store, making persistence order-dependent. A drag is one edit, not ninety:
 * the transient half previews on the session store and the engine, and the
 * commit lands once on release, the cadence every other drag-committing knob
 * on this panel uses.
 */

import { commitGrandBouleDeviceState } from './commitGrandBouleDeviceState';

type SetGrandBouleVelocityCurveInput = {
    /** Device id — the address project truth and the undo entry are keyed by. */
    deviceId: string;
    engine: GrandBouleEngineHandle;
    exponent: number;
    store: Store<GrandBouleState>;
    /** True while the knob is under the pointer; the commit lands on release. */
    isTransient?: boolean;
};

export function setGrandBouleVelocityCurve(input: SetGrandBouleVelocityCurveInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }

    const clamped = Math.max(0.5, Math.min(2.0, input.exponent));

    input.store.set({
        ...state,
        parameters: {
            ...state.parameters,
            velocityCurve: clamped,
        },
    });

    input.engine.setParam({ name: 'velocity_curve', value: clamped });

    if (input.isTransient === true) {
        return;
    }

    const persisted: GrandBoulePersistedState = {
        morph: state.morph,
        temperament: state.temperament,
        parameters: {
            ...state.parameters,
            velocityCurve: clamped,
        },
    };
    commitGrandBouleDeviceState(input.deviceId, persisted);
}
