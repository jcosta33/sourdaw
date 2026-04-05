import { createMidiNote as createMidiNoteFactory } from '../models/MidiNote';
import { type MidiNote } from '../models/MidiNote';

/**
 * Construct a new MidiNote with a freshly allocated unique id.
 * Public use-case surface — the underlying counter is a private model detail.
 */
export function createMidiNote(
    pitch: number,
    startBeat: number,
    duration: number,
    velocity = 100,
    probability = 100
): MidiNote {
    return createMidiNoteFactory(pitch, startBeat, duration, velocity, probability);
}
