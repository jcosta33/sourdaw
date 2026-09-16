import { clampMidiData7, clampVelocity, DEFAULT_NOTE_VELOCITY } from '#/utils/midiData';

import { type MidiNote } from '../models/MidiNote';

type NormalizeMidiNoteInputInput = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity?: number;
};

export function normalizeMidiNoteInput(input: NormalizeMidiNoteInputInput): MidiNote {
    return {
        id: input.id,
        pitch: Math.round(clampMidiData7(input.pitch)),
        startBeat: Math.max(0, input.startBeat),
        duration: Math.max(0.0625, input.duration),
        velocity: Math.round(clampVelocity(input.velocity ?? DEFAULT_NOTE_VELOCITY)),
        probability: 100,
    };
}
