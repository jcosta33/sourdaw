import { type NoteEventTime } from '@spotify/basic-pitch';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { batchAddMidiNotes } from '#/modules/MIDI/useCases/midiNoteCrud/batchAddMidiNotes';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';

type SourceClip = {
    startBeat: number;
    endBeat: number;
    name: string;
};

export type InsertPolyphonicMidiNotesResult = {
    clipId: string;
    trackId: string;
};

/**
 * Insert polyphonic note events into the timeline.
 * Creates or reuses a MIDI track and clip, then batch-writes all notes.
 */
export function insertPolyphonicMidiNotes(
    notes: NoteEventTime[],
    sourceClip: SourceClip,
    targetTrackId: string
): InsertPolyphonicMidiNotesResult | null {
    const tempo = getTransportState()?.tempo ?? 120;
    const beatsPerSecond = tempo / 60;

    let midiTrackId = targetTrackId;
    const existingTrack = getAllTracks().find((t) => t.id === targetTrackId);
    if (!existingTrack || existingTrack.kind !== 'midi') {
        const newTrack = addTrack({ name: `${sourceClip.name} (MIDI)`, kind: 'midi' });
        if (!newTrack) {
            return null;
        }
        midiTrackId = newTrack.id;
    }

    const midiClip = addClip({
        trackId: midiTrackId,
        startBeat: sourceClip.startBeat,
        endBeat: Math.ceil(sourceClip.endBeat),
        name: `${sourceClip.name} → MIDI (poly)`,
        type: 'midi',
    });

    if (!midiClip) {
        return null;
    }

    // Insert all detected notes in a single batch store mutation (avoids O(N) CRDT flood)
    batchAddMidiNotes(
        midiClip.id,
        notes.map((note) => ({
            pitch: note.pitchMidi,
            startBeat: note.startTimeSeconds * beatsPerSecond,
            duration: Math.max(0.0625, note.durationSeconds * beatsPerSecond),
            velocity: Math.max(1, Math.min(127, Math.round(note.amplitude * 127))),
        }))
    );

    return { clipId: midiClip.id, trackId: midiTrackId };
}
