import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { selectMidiRecordingPassNotes } from '#/modules/MIDI/useCases';

import { type MidiNote } from '../../models/MidiNoteViewTypes';

/** The selected take's advancing media window, with beat zero at its visible head. */
export function readPianoRollRecordingPass(clipId: string) {
    const take = takeLaneStore.value?.lanes
        .flatMap((lane) => lane.takes)
        .find(
            (candidate) => candidate.clipId === clipId && candidate.selected && candidate.recordingPassId !== undefined
        );
    if (!take) {
        return undefined;
    }
    const clip = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!clip) {
        return undefined;
    }
    const sourceStartBeat =
        (clip.midiOffsetBeats ?? 0) + (take.sourceOffsetBeats ?? 0) + take.startBeat - clip.startBeat;
    return {
        recordingPassId: take.recordingPassId,
        sourceStartBeat,
        sourceEndBeat: sourceStartBeat + take.endBeat - take.startBeat,
        startBeat: take.startBeat,
        endBeat: take.endBeat,
    };
}

const projections = new WeakMap<MidiNote[], { passKey: string; notes: MidiNote[] }>();

/** Preserve IDs; only the view's beats are wrapped. Mutations invert this projection. */
export function projectPianoRollRecordingPassNotes(clipId: string, notes: MidiNote[]): MidiNote[] {
    const pass = readPianoRollRecordingPass(clipId);
    if (!pass) {
        return notes;
    }
    const passKey = `${pass.recordingPassId}:${pass.sourceStartBeat}:${pass.sourceEndBeat}`;
    const cached = projections.get(notes);
    if (cached?.passKey === passKey) {
        return cached.notes;
    }
    const projected = selectMidiRecordingPassNotes(notes, pass).map((note) => ({
        ...note,
        startBeat: note.startBeat - pass.sourceStartBeat,
    }));
    projections.set(notes, { passKey, notes: projected });
    return projected;
}
