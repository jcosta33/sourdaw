import { type Store } from '#/infra/store/types';
/**
 * Set the velocity curve exponent for the Grand Boule piano.
 *
 * Controls how MIDI velocity maps to hammer force:
 *   0.5 = compressed (soft touch, higher minimum)
 *   1.0 = linear
 *   2.0 = expanded (requires stronger strikes for forte)
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

type SetGrandBouleVelocityCurveInput = {
    engine: GrandBouleEngineHandle;
    exponent: number;
    store: Store<GrandBouleState>;
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
}
