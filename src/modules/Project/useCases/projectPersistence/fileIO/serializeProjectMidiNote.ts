import { type SerializedNote, type RuntimeNote } from './midiStateMapping';

export function serializeProjectMidiNote(note: RuntimeNote): SerializedNote {
    return {
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
}
