import { clampMidiData7, clampVelocity, DEFAULT_NOTE_VELOCITY } from '#/utils/midiData';

import { type MidiNote } from '../models/MidiNote';

import { cloneMidiNoteForAdmission } from './cloneMidiNoteForAdmission';

type NormalizeMidiNoteInputInput = Omit<MidiNote, 'velocity'> & { velocity?: number };

export function normalizeMidiNoteInput(input: NormalizeMidiNoteInputInput): MidiNote {
    return cloneMidiNoteForAdmission({
        ...input,
        id: input.id,
        pitch: Math.round(clampMidiData7(input.pitch)),
        startBeat: Math.max(0, input.startBeat),
        duration: Math.max(0.0625, input.duration),
        velocity: Math.round(clampVelocity(input.velocity ?? DEFAULT_NOTE_VELOCITY)),
        probability: input.probability ?? 100,
    });
}
