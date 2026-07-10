import { type MidiStoreState } from '#/modules/MIDI/stores';

import { type ProjectMidiNote } from '../../../models/ProjectData';

type RuntimeNote = MidiStoreState['notesByClipId'][string][number];

export function serializeProjectMidiNote(note: RuntimeNote): ProjectMidiNote {
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
