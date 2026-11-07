import { type NoteEventTime } from '@spotify/basic-pitch';

import { executeAppActionBatch } from '#/modules/Command/useCases';
import { DEFAULT_TEMPO_BPM } from '#/modules/Transport/stores';
import { getTransportState } from '#/modules/Transport/useCases';

import { resolveMidiTrackId } from './resolveMidiTrackId';

type SourceClip = {
    startBeat: number;
    endBeat: number;
    name: string;
};

export type InsertPolyphonicMidiNotesResult = {
    clipId: string;
    trackId: string;
};

export async function insertPolyphonicMidiNotes(
    notes: NoteEventTime[],
    sourceClip: SourceClip,
    targetTrackId: string
): Promise<InsertPolyphonicMidiNotesResult | null> {
    if (notes.length === 0) return null;
    const tempo = getTransportState()?.tempo ?? DEFAULT_TEMPO_BPM;
    const beatsPerSecond = tempo / 60;

    const destination = resolveMidiTrackId(targetTrackId, `${sourceClip.name} (MIDI)`);
    const clipId = `clip-audio-midi-${crypto.randomUUID()}`;
    const result = await executeAppActionBatch(
        [
            ...destination.actions,
            {
                type: 'addClip',
                payload: {
                    id: clipId,
                    trackId: destination.trackId,
                    startBeat: sourceClip.startBeat,
                    endBeat: Math.ceil(sourceClip.endBeat),
                    name: `${sourceClip.name} → MIDI (poly)`,
                    type: 'midi',
                },
            },
            {
                type: 'addNotes',
                payload: {
                    clipId,
                    notes: notes.map((note) => ({
                        pitch: note.pitchMidi,
                        startBeat: note.startTimeSeconds * beatsPerSecond,
                        duration: Math.max(0.0625, note.durationSeconds * beatsPerSecond),
                        velocity: Math.max(1, Math.min(127, Math.round(note.amplitude * 127))),
                    })),
                },
            },
        ],
        {
            groupId: `audio-to-midi-${crypto.randomUUID()}`,
            groupLabel: 'Convert polyphonic audio to MIDI',
            source: 'manual',
            requireCompensation: true,
        }
    );
    return result.status === 'committed' || result.status === 'committed-with-warning'
        ? { clipId, trackId: destination.trackId }
        : null;
}
