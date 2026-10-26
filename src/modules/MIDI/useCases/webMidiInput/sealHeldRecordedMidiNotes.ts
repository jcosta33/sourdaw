import { audioEngine } from '#/modules/AudioEngine/useCases';
import { type RecordingMidiAdmission } from '#/modules/Arrangement/stores';
import { readBeatAtSamples, transportStore } from '#/modules/Transport/stores';

import { activeNotes } from '../../repositories/webMidi/state';
import { type ActiveNoteData } from '../../models/WebMidiTypes';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { appendRecordedMidiNote } from '../appendRecordedMidiNote';
import { createMidiNote } from '../createMidiNote';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { resolveRecordingPlacement } from './resolveRecordingPlacement';
import { recordHeldNoteExpression } from './recordHeldNoteExpression';
import { withRecordedNoteExpression } from './withRecordedNoteExpression';

type SealHeldRecordedMidiNotesInput = {
    clipId: string;
    trackId: string;
    endAudioTime?: number;
    admissions?: readonly RecordingMidiAdmission[];
    endSourceBeat?: number;
};

/** Close registered held keys inside the recording's existing Stop commit. */
export function sealHeldRecordedMidiNotes({
    clipId,
    trackId,
    endAudioTime,
    admissions = [],
    endSourceBeat,
}: SealHeldRecordedMidiNotesInput): void {
    const stoppedAt = endAudioTime ?? audioEngine.context.currentTime;
    for (const admitted of admissions) {
        if (admitted.clipId !== clipId || admitted.trackId !== trackId || admitted.onsetAudioTime >= stoppedAt) {
            continue;
        }
        const durationSeconds = Math.max(
            0,
            Math.min(admitted.releaseAudioTime ?? stoppedAt, stoppedAt) - admitted.onsetAudioTime
        );
        const tempo = transportStore.value?.tempo ?? 120;
        const durationBeats =
            admitted.releaseSourceBeat === undefined
                ? endSourceBeat === undefined
                    ? (durationSeconds * tempo) / 60
                    : endSourceBeat - admitted.onsetSourceBeat
                : admitted.releaseSourceBeat - admitted.onsetSourceBeat;
        const note = createMidiNote(
            admitted.note,
            admitted.onsetSourceBeat,
            Math.max(durationBeats, 0.0625),
            admitted.velocity
        );
        if (!admitted.initialExpression && !admitted.expressionChanges?.length) {
            appendRecordedMidiNote({ clipId, note });
            continue;
        }
        const initial = admitted.initialExpression;
        const held: ActiveNoteData = {
            startTime: admitted.onsetAudioTime,
            startBeat: admitted.onsetSourceBeat,
            channel: admitted.channel,
            note: admitted.note,
            velocity: admitted.velocity,
            trackId,
            instrumentTrackId: trackId,
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
        appendRecordedMidiNote({
            clipId,
            note: withRecordedNoteExpression(
                note,
                held,
                (seconds) => sourceOffsets.get(seconds) ?? (seconds * tempo) / 60
            ),
        });
    }
    for (const held of activeNotes.values()) {
        if (held.trackId !== trackId || held.recordingClipId !== clipId || held.startTime >= stoppedAt) {
            continue;
        }
        if (admissions.some((admitted) => admitted.id === held.recordingAdmissionId)) {
            continue;
        }
        const placement = resolveRecordingPlacement(midiMessageHandlerDependencies, {
            trackId,
            admittedBeat: held.startBeat,
        });
        if (!placement || placement.clipId !== clipId) {
            continue;
        }
        const durationSeconds = stoppedAt - held.startTime;
        const secondsToBeats = (seconds: number): number =>
            placement.flatTimeline
                ? (seconds * placement.defaultTempo) / 60
                : readBeatAtSamples({ samples: placement.originSeconds + seconds, sampleRate: 1 }) -
                  placement.latencyAdjustedBeat;
        const note = createMidiNote(
            held.note,
            placement.clipBeat,
            Math.max(secondsToBeats(durationSeconds), 0.0625),
            held.velocity ?? 100
        );
        appendRecordedMidiNote({
            clipId,
            note: getMpeEnabled() ? withRecordedNoteExpression(note, held, secondsToBeats) : note,
        });
    }
}
