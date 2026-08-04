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
        pitch: Math.round(Math.max(0, Math.min(127, input.pitch))),
        startBeat: Math.max(0, input.startBeat),
        duration: Math.max(0.0625, input.duration),
        velocity: Math.round(Math.max(1, Math.min(127, input.velocity ?? 100))),
        probability: 100,
    };
}
