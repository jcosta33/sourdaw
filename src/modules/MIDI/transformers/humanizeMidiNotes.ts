import { clampVelocity } from '#/utils/midiData';
import { createSeededRandom } from '#/utils/SeededRandom/SeededRandom';

import { type MidiNote } from '../models/MidiNote';

/**
 * Moves each note's start up to an eighth of `timingAmount` beats either way (never before the clip start)
 * and its velocity up to five times `velocityAmount` steps either way, drawing the same two values per note
 * from the seed in note order. The write, the undo preview and the batch projection all call this one map,
 * so the notes an undo guard expects are exactly the notes the write produces.
 */
export function humanizeMidiNotes(
    notes: readonly MidiNote[],
    timingAmount: number,
    velocityAmount: number,
    seed: number
): MidiNote[] {
    const rng = createSeededRandom(seed);
    return notes.map((note) => ({
        ...note,
        startBeat: Math.max(0, note.startBeat + (rng() - 0.5) * timingAmount * 0.25),
        velocity: clampVelocity(note.velocity + Math.round((rng() - 0.5) * velocityAmount * 10)),
    }));
}
