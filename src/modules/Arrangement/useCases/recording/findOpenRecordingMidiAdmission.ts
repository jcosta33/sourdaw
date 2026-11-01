import { activeRecordingRef, type RecordingMidiAdmission } from '../../stores/activeRecordingRef';

import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

export function findOpenRecordingMidiAdmission(channel: number, note: number): RecordingMidiAdmission | undefined {
    if (!takeOwnsRecordingRoot()) {
        return undefined;
    }
    return activeRecordingRef.midiAdmissions.findLast(
        (candidate) =>
            candidate.channel === channel && candidate.note === note && candidate.releaseAudioTime === undefined
    );
}
