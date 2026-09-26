import { type MidiStoreState } from '#/modules/MIDI/stores';

import { type ProjectMidiNote, type ProjectMidiNoteExpression } from '../../../models/ProjectData';

type RuntimeNote = MidiStoreState['notesByClipId'][string][number];
type RuntimeExpression = NonNullable<RuntimeNote['expression']>;
type RuntimeCurve = NonNullable<RuntimeExpression['pressure']>;

function serializeCurve(curve: RuntimeCurve) {
    return curve.map((point) => ({ offsetBeats: point.offsetBeats, value: point.value }));
}

function serializeExpression(expression: RuntimeExpression): ProjectMidiNoteExpression {
    const serialized: ProjectMidiNoteExpression = {};
    if (expression.pressure !== undefined) {
        serialized.pressure = serializeCurve(expression.pressure);
    }
    if (expression.slide !== undefined) {
        serialized.slide = serializeCurve(expression.slide);
    }
    if (expression.pitchBend !== undefined) {
        serialized.pitchBend = serializeCurve(expression.pitchBend);
    }
    return serialized;
}

/**
 * The field-by-field rebuild is deliberate — it keeps the saved schema fixed
 * rather than whatever the runtime note happens to hold. That is why every new
 * runtime field has to be added here as well, and why three were being dropped.
 *
 * The optional fields below are written only when the note carries them. Absence is
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
    if (note.expression !== undefined) {
        serialized.expression = serializeExpression(note.expression);
    }

    return serialized;
}
