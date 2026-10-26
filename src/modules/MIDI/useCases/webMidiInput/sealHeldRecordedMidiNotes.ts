import { audioEngine } from '#/modules/AudioEngine/useCases';
import { readBeatAtSamples } from '#/modules/Transport/stores';

import { activeNotes } from '../../repositories/webMidi/state';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { appendRecordedMidiNote } from '../appendRecordedMidiNote';
import { createMidiNote } from '../createMidiNote';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { resolveRecordingPlacement } from './resolveRecordingPlacement';
import { withRecordedNoteExpression } from './withRecordedNoteExpression';

type SealHeldRecordedMidiNotesInput = {
    clipId: string;
    trackId: string;
    endAudioTime?: number;
};

/** Close registered held keys inside the recording's existing Stop commit. */
export function sealHeldRecordedMidiNotes({ clipId, trackId, endAudioTime }: SealHeldRecordedMidiNotesInput): void {
    const stoppedAt = endAudioTime ?? audioEngine.context.currentTime;
    for (const held of activeNotes.values()) {
        if (held.trackId !== trackId || held.recordingClipId !== clipId || held.startTime >= stoppedAt) {
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
