import { type NoteEventTime } from '@spotify/basic-pitch';

import { addClip, getAllTracks } from '#/modules/Arrangement/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { batchAddMidiNotes } from '#/modules/MIDI/useCases';
import { getTransportState } from '#/modules/Transport/useCases';

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
 * Resolve the MIDI track to write into. If `targetTrackId` is already a MIDI track its
 * id is returned unchanged. Otherwise a new MIDI track is created by **dispatching** an
 * `addTrack` AppAction (not a direct `addTrack(...)` store mutation) so the creation is
 * recorded on the undo history — undoing the conversion then also removes the track it
 * created, instead of leaving an orphan behind. Returns the new track's id, or `null` if
 * creation failed.
 *
 * The `addTrack` handler mutates the track store synchronously inside `executeAppAction`
 * (before its returned promise resolves), so the new track is visible to the
 * `getAllTracks()` read below without awaiting; the promise carries only the undo /
 * history bookkeeping, which we intentionally let settle on the microtask queue.
 */
function resolveMidiTrackId(targetTrackId: string, trackName: string): string | null {
    const existingTrack = getAllTracks().find((track) => track.id === targetTrackId);
    if (existingTrack && existingTrack.kind === 'midi') {
        return targetTrackId;
    }

    const idsBefore = new Set(getAllTracks().map((track) => track.id));
    void executeAppAction({ type: 'addTrack', payload: { name: trackName, kind: 'midi' } });
    const created = getAllTracks().find((track) => !idsBefore.has(track.id) && track.kind === 'midi');
    return created?.id ?? null;
}

export function insertPolyphonicMidiNotes(
    notes: NoteEventTime[],
    sourceClip: SourceClip,
    targetTrackId: string
): InsertPolyphonicMidiNotesResult | null {
    const tempo = getTransportState()?.tempo ?? 120;
    const beatsPerSecond = tempo / 60;

    const midiTrackId = resolveMidiTrackId(targetTrackId, `${sourceClip.name} (MIDI)`);
    if (!midiTrackId) {
        return null;
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
