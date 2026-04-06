/**
 * Trigger a Grand Boule note.
 *
 * Applies the store's velocity curve and dispatches to the WASM engine
 * handle. Does nothing if the engine has not yet attached.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { grandBouleStore } from '../stores/grandBouleStore';

type TriggerGrandBouleNoteInput = {
    engine: GrandBouleEngineHandle;
    midiNote: number;
    /** Normalised velocity in 0.0 .. 1.0 (pre-curve). */
    velocity: number;
};

export const triggerGrandBouleNote = (input: TriggerGrandBouleNoteInput): void => {
    if (!input.engine.isReady()) {
        return;
    }
    const state = grandBouleStore.value;
    const exponent = state === null ? 1.0 : state.parameters.velocityCurve;
    const normalised = Math.max(0, Math.min(1, input.velocity));
    const shaped = Math.pow(normalised, exponent);
    input.engine.noteOn({ midiNote: input.midiNote, velocity: shaped });
};
