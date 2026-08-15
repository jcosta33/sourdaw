import { type MidiStoreState } from '#/modules/MIDI/stores';

import { type ProjectMidiNote } from '../../../models/ProjectData';

type RuntimeNote = MidiStoreState['notesByClipId'][string][number];

/**
 * The field-by-field rebuild is deliberate — it keeps the saved schema fixed
 * rather than whatever the runtime note happens to hold. That is why every new
 * runtime field has to be added here as well, and why three were being dropped.
 *
 * The three below are written only when the note carries them. Absence is
 * meaningful for each: it is what makes the reader fall back to a default, and
 * writing a fabricated value would make a plain note claim expression it never
 * had.
 */
export function serializeProjectMidiNote(note: RuntimeNote): ProjectMidiNote {
    const serialized: ProjectMidiNote = {
        id: note.id,
        pitch: note.pitch,
        startBeat: note.startBeat,
        duration: note.duration,
        velocity: note.velocity,
        probability: note.probability ?? 100,
        pressure: note.pressure ?? 0,
        slide: note.slide ?? 0,
        pitchBend: note.pitchBend ?? 0,
    };

    // The bend range is what gives the stored `pitchBend` its meaning. Read back
    // absent, the engine substitutes the MPE default of 48 semitones, so a bend
    // recorded on a controller set to +/-2 replays 24x too wide.
    if (note.pitchBendRangeSemitones !== undefined) {
        serialized.pitchBendRangeSemitones = note.pitchBendRangeSemitones;
    }
    if (note.channel !== undefined) {
        serialized.channel = note.channel;
    }
    if (note.articulation !== undefined) {
        serialized.articulation = note.articulation;
    }

    return serialized;
}
