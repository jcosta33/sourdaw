import { type RecordingMidiAdmission } from '#/modules/Arrangement/stores';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { readBeatAtSamples } from '#/modules/Transport/stores';

import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { activeNotes } from '../../repositories/webMidi/state';
import { appendRecordedMidiNote } from '../appendRecordedMidiNote';
import { createMidiNote } from '../createMidiNote';

import { createRecordedAdmittedMidiNote } from './createRecordedAdmittedMidiNote';
import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { resolveRecordingPlacement } from './resolveRecordingPlacement';
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
        appendRecordedMidiNote({ clipId, note: createRecordedAdmittedMidiNote(admitted, stoppedAt, endSourceBeat) });
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
        const secondsToBeats = (seconds: number): number => {
            if (placement.flatTimeline) {
                return (seconds * placement.defaultTempo) / 60;
            }
            return (
                readBeatAtSamples({ samples: placement.originSeconds + seconds, sampleRate: 1 }) -
                placement.latencyAdjustedBeat
            );
        };
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
