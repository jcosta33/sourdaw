/**
 * Set the velocity curve exponent for the Grand Boule piano.
 *
 * Controls how MIDI velocity maps to hammer force (spec §3.1):
 *   0.5 = compressed (soft touch, higher minimum)
 *   1.0 = linear
 *   2.0 = expanded (requires stronger strikes for forte)
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { grandBouleStore } from '../stores/grandBouleStore';

type SetGrandBouleVelocityCurveInput = {
    engine: GrandBouleEngineHandle;
    exponent: number;
};

export const setGrandBouleVelocityCurve = (input: SetGrandBouleVelocityCurveInput): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }

    const clamped = Math.max(0.5, Math.min(2.0, input.exponent));

    grandBouleStore.set({
        ...state,
        parameters: {
            ...state.parameters,
            velocityCurve: clamped,
        },
    });

    input.engine.setParam({ name: 'velocity_curve', value: clamped });
};
