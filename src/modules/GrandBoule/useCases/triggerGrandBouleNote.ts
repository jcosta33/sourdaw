/**
 * Trigger a Grand Boule note.
 *
 * Applies the store's midi calibration curve and dispatches to the WASM engine
 * handle. Does nothing if the engine has not yet attached.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';
import { applyVelocityCurve } from './calibrateGrandBouleMidi/applyVelocityCurve';
import { type Store } from '#/infra/store/types';

type TriggerGrandBouleNoteInput = {
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    midiNote: number;
    /** Normalised velocity in 0.0 .. 1.0 (pre-curve). */
    velocity: number;
};

export const triggerGrandBouleNote = (input: TriggerGrandBouleNoteInput): void => {
    if (!input.engine.isReady()) {
        return;
    }
    const state = input.store.value;
    const calibration = state?.midiCalibration;
    // Map normalized velocity back to 0-127 for applyVelocityCurve, then back to 0-1
    const shaped = calibration ? applyVelocityCurve(input.velocity * 127, calibration) : input.velocity;
    input.engine.noteOn({ midiNote: input.midiNote, velocity: shaped });
};
