/**
 * Trigger a Grand Boule note with MIDI 2.0 fidelity.
 *
 * Accepts 16-bit velocity (0..65535) and a signed microtuning offset in
 * cents. The offset is converted to the engine's Q24 semitone format
 * before being dispatched.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';

type TriggerGrandBouleMicrotunedNoteInput = {
    engine: GrandBouleEngineHandle;
    midiNote: number;
    velocity16bit: number;
    offsetCents: number;
};

const Q24_PER_SEMITONE = 1 << 24;

export const triggerGrandBouleMicrotunedNote = (input: TriggerGrandBouleMicrotunedNoteInput): void => {
    const velocity = Math.max(0, Math.min(0xffff, Math.round(input.velocity16bit)));
    const semitones = input.offsetCents / 100;
    const pitchOffsetQ24 = Math.round(semitones * Q24_PER_SEMITONE);
    input.engine.noteOnMidi2({
        midiNote: input.midiNote,
        velocity16bit: velocity,
        pitchOffsetQ24,
    });
};
