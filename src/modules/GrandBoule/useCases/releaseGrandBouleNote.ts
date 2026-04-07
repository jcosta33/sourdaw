/**
 * Release a sustaining Grand Boule note.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';

type ReleaseGrandBouleNoteInput = {
    engine: GrandBouleEngineHandle;
    midiNote: number;
};

export const releaseGrandBouleNote = (input: ReleaseGrandBouleNoteInput): void => {
    if (!input.engine.isReady()) {
        return;
    }
    input.engine.noteOff({ midiNote: input.midiNote });
};
