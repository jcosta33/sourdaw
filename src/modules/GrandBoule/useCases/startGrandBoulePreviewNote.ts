import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { shapeNormalisedGrandBouleVelocity } from './shapeNormalisedGrandBouleVelocity';

type StartGrandBoulePreviewNoteInput = {
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    midiNote: number;
    velocity: number;
};

/** Start a panel preview using the same calibrated velocity as ordinary notes. */
export function startGrandBoulePreviewNote(input: StartGrandBoulePreviewNoteInput): (() => void) | undefined {
    const velocity = shapeNormalisedGrandBouleVelocity(input.velocity, input.store.value?.midiCalibration);
    return input.engine.startPreviewNote({ midiNote: input.midiNote, velocity });
}
