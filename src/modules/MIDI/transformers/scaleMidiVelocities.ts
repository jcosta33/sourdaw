import { type MidiNote } from '../models/MidiNote';

type ScaleMidiVelocitiesInput = {
    notes: readonly MidiNote[];
    factor: number;
};

export function scaleMidiVelocities(input: ScaleMidiVelocitiesInput): MidiNote[] {
    return input.notes.map((note) => ({
        ...note,
        velocity: Math.max(1, Math.min(127, Math.round(note.velocity * input.factor))),
    }));
}
