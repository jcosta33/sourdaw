import { activeRecordingRef, type RecordingMidiAdmission } from '../../stores/activeRecordingRef';

import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

export function findOpenRecordingMidiMemberAdmission(channel: number): RecordingMidiAdmission | undefined {
    if (!takeOwnsRecordingRoot()) {
        return undefined;
    }
    return activeRecordingRef.midiAdmissions.findLast(
        (candidate) => candidate.channel === channel && candidate.releaseAudioTime === undefined
    );
}
