import { clampVelocity } from '#/utils/midiData';

import { type MidiNote } from '../models/MidiNote';

type SetMidiVelocitiesInput = {
    notes: readonly MidiNote[];
    velocity: number;
};

export function setMidiVelocities(input: SetMidiVelocitiesInput): MidiNote[] {
    const velocity = clampVelocity(input.velocity);
    return input.notes.map((note) => ({ ...note, velocity }));
}
