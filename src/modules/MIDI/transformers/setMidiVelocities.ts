import { type MidiNote } from '../models/MidiNote';

type SetMidiVelocitiesInput = {
    notes: readonly MidiNote[];
    velocity: number;
};

export function setMidiVelocities(input: SetMidiVelocitiesInput): MidiNote[] {
    const velocity = Math.max(1, Math.min(127, input.velocity));
    return input.notes.map((note) => ({ ...note, velocity }));
}
