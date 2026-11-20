/**
 * Trigger a Grand Boule note.
 *
 * Applies the store's midi calibration curve and dispatches to the WASM engine
 * handle. Does nothing if the engine has not yet attached.
 */

import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { shapeNormalisedGrandBouleVelocity } from './shapeNormalisedGrandBouleVelocity';

type TriggerGrandBouleNoteInput = {
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    midiNote: number;
    /** Normalised velocity in 0.0 .. 1.0 (pre-curve). */
    velocity: number;
};

export function triggerGrandBouleNote(input: TriggerGrandBouleNoteInput): void {
    if (!input.engine.isReady()) {
        return;
    }
    const shaped = shapeNormalisedGrandBouleVelocity(input.velocity, input.store.value?.midiCalibration);
    input.engine.noteOn({ midiNote: input.midiNote, velocity: shaped });
}
