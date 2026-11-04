import { activeRecordingRef, type RecordingMidiAdmission } from '../../stores/activeRecordingRef';

import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

export function getRecordingMidiAdmission(id: string): RecordingMidiAdmission | undefined {
    if (!takeOwnsRecordingRoot()) {
        return undefined;
    }
    return activeRecordingRef.midiAdmissions.find((candidate) => candidate.id === id);
}
