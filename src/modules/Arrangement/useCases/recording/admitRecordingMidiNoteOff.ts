import { findOpenRecordingMidiAdmission } from './findOpenRecordingMidiAdmission';
import { recordingCommitGroups } from './recordingCommitGroup';
import { recordingMidiBound } from './recordingMidiBound';
import { recordingMidiSourceBeatAt } from './recordingMidiSourceBeatAt';
import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

type EventPosition = { beat: number; passIndex: number };

export function admitRecordingMidiNoteOff(input: {
    channel: number;
    note: number;
    audioTime: number;
    position: EventPosition;
}): void {
    if (!takeOwnsRecordingRoot()) {
        return;
    }
    const admitted = findOpenRecordingMidiAdmission(input.channel, input.note);
    if (
        !admitted ||
        !recordingCommitGroups.reconcileAdmission(admitted.clipId) ||
        input.audioTime < admitted.onsetAudioTime
    ) {
        return;
    }
    const bound = recordingMidiBound.read();
    if (bound.status === 'bounded') {
        const exclusiveEnd = recordingMidiSourceBeatAt(admitted.clipId, bound.ending.midiPosition);
        if (exclusiveEnd !== null) {
            admitted.exclusiveSourceEndBeat = exclusiveEnd;
        }
    }
    const endsAtBound = bound.status === 'bounded' && input.audioTime >= bound.ending.contextSeconds;
    const releaseSourceBeat = recordingMidiSourceBeatAt(
        admitted.clipId,
        endsAtBound ? bound.ending.midiPosition : input.position
    );
    if (releaseSourceBeat === null) {
        return;
    }
    admitted.releaseAudioTime = endsAtBound ? bound.ending.contextSeconds : input.audioTime;
    admitted.releaseSourceBeat = releaseSourceBeat;
}
