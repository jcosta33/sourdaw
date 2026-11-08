import { type RecordingMidiAdmission } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';

import { type MidiNote } from '../../models/MidiNote';
import { type ActiveNoteData } from '../../models/WebMidiTypes';
import { createMidiNote } from '../createMidiNote';

import { recordHeldNoteExpression } from './recordHeldNoteExpression';
import { withRecordedNoteExpression } from './withRecordedNoteExpression';

function recordedNoteDuration(
    admitted: RecordingMidiAdmission,
    durationBeats: number,
    exclusiveEndSourceBeat?: number
): number | null {
    let duration = Math.max(durationBeats, 0.0625);
    let exclusiveEnd = admitted.exclusiveSourceEndBeat;
    if (exclusiveEndSourceBeat !== undefined) {
        if (exclusiveEnd === undefined) {
            exclusiveEnd = exclusiveEndSourceBeat;
        } else {
            exclusiveEnd = Math.min(exclusiveEnd, exclusiveEndSourceBeat);
        }
    }
    if (exclusiveEnd !== undefined) {
        const available = exclusiveEnd - admitted.onsetSourceBeat;
        if (!Number.isFinite(available) || available <= 0) {
            return null;
        }
        duration = Math.min(duration, available);
        if (!Number.isFinite(duration) || duration <= 0) {
            return null;
        }
    }
    return duration;
}

/** The owner admission is authoritative whether key-up or Stop closes the note. */
export function createRecordedAdmittedMidiNote(
    admitted: RecordingMidiAdmission,
    endedAt: number,
    endSourceBeat?: number,
    exclusiveEndSourceBeat?: number
): MidiNote | null {
    const durationSeconds = Math.max(
        0,
        Math.min(admitted.releaseAudioTime ?? endedAt, endedAt) - admitted.onsetAudioTime
    );
    const tempo = transportStore.value?.tempo ?? 120;
    let durationBeats: number;
    if (admitted.releaseSourceBeat !== undefined) {
        durationBeats = admitted.releaseSourceBeat - admitted.onsetSourceBeat;
    } else if (endSourceBeat !== undefined) {
        durationBeats = endSourceBeat - admitted.onsetSourceBeat;
    } else {
        durationBeats = (durationSeconds * tempo) / 60;
    }
    const duration = recordedNoteDuration(admitted, durationBeats, exclusiveEndSourceBeat);
    if (duration === null) {
        return null;
    }
    const note = createMidiNote(admitted.note, admitted.onsetSourceBeat, duration, admitted.velocity);
    // Stored playback bends a note only by its own channel's recorded wheel, as the live input does.
    note.channel = admitted.channel;
    if (admitted.onsetPassIndex !== undefined) {
        note.recordingPassIndex = admitted.onsetPassIndex;
    }
    if (!admitted.initialExpression && !admitted.expressionChanges?.length) {
        return note;
    }
    const initial = admitted.initialExpression;
    const held: ActiveNoteData = {
        startTime: admitted.onsetAudioTime,
        startBeat: admitted.onsetSourceBeat,
        channel: admitted.channel,
        note: admitted.note,
        velocity: admitted.velocity,
        trackId: admitted.trackId,
        instrumentTrackId: admitted.trackId,
        pressure: initial?.pressure,
        slide: initial?.slide,
        pitchBend: initial?.pitchBend,
        pitchBendRangeSemitones: initial?.pitchBendRangeSemitones,
    };
    const sourceOffsets = new Map<number, number>();
    for (const change of admitted.expressionChanges ?? []) {
        const offsetSeconds = change.audioTime - admitted.onsetAudioTime;
        sourceOffsets.set(offsetSeconds, change.sourceBeat - admitted.onsetSourceBeat);
        recordHeldNoteExpression(held, {
            dimension: change.dimension,
            value: change.value,
            eventTime: change.audioTime,
            bendRangeSemitones: change.bendRangeSemitones,
        });
        held[change.dimension] = change.value;
        if (change.dimension === 'pitchBend') {
            held.pitchBendRangeSemitones = change.bendRangeSemitones;
        }
    }
    return withRecordedNoteExpression(note, held, (seconds) => sourceOffsets.get(seconds) ?? (seconds * tempo) / 60);
}
