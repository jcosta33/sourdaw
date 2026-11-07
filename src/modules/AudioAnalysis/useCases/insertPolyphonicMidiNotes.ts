import { type NoteEventTime } from '@spotify/basic-pitch';

import { executeAppActionBatch } from '#/modules/Command/useCases';
import { projectRevisionMatchesLiveIgnoringSaveWrites } from '#/modules/CrdtDocument/useCases';
import { DEFAULT_TEMPO_BPM } from '#/modules/Transport/stores';
import { getTransportState } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { ADD_NOTES_MAX_NOTES_PER_COMMAND } from '#/utils/midiNoteBatchLimits';

import { resolveMidiTrackId } from './resolveMidiTrackId';

type SourceClip = {
    startBeat: number;
    endBeat: number;
    name: string;
    projectRevision: string;
    signal?: AbortSignal;
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
    try {
        if (sourceClip.signal?.aborted || !projectRevisionMatchesLiveIgnoringSaveWrites(sourceClip.projectRevision)) {
            return null;
        }
        const tempo = getTransportState()?.tempo ?? DEFAULT_TEMPO_BPM;
        const beatsPerSecond = tempo / 60;

        const destination = resolveMidiTrackId(targetTrackId, `${sourceClip.name} (MIDI)`);
        const clipId = `clip-audio-midi-${crypto.randomUUID()}`;
        const actions: AppAction[] = [
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
        ];
        const midiNotes = notes.map((note) => ({
            pitch: note.pitchMidi,
            startBeat: note.startTimeSeconds * beatsPerSecond,
            duration: Math.max(0.0625, note.durationSeconds * beatsPerSecond),
            velocity: Math.max(1, Math.min(127, Math.round(note.amplitude * 127))),
        }));
        for (let offset = 0; offset < midiNotes.length; offset += ADD_NOTES_MAX_NOTES_PER_COMMAND) {
            actions.push({
                type: 'addNotes',
                payload: { clipId, notes: midiNotes.slice(offset, offset + ADD_NOTES_MAX_NOTES_PER_COMMAND) },
            });
        }
        const result = await executeAppActionBatch(actions, {
            groupId: `audio-to-midi-poly-${crypto.randomUUID()}`,
            groupLabel: 'Convert polyphonic audio to MIDI',
            source: 'manual',
            requireCompensation: true,
            signal: sourceClip.signal,
            shouldExecute: () =>
                sourceClip.signal?.aborted !== true &&
                projectRevisionMatchesLiveIgnoringSaveWrites(sourceClip.projectRevision),
        });
        if (result.status !== 'committed' && result.status !== 'committed-with-warning') {
            return null;
        }
        return { clipId, trackId: destination.trackId };
    } catch {
        return null;
    }
}
