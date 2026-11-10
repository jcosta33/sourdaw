import { activeRecordingRef, type RecordingMidiAdmission } from '../../stores/activeRecordingRef';

import { recordingCommitGroups } from './recordingCommitGroup';
import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

export function getRecordingMidiAdmission(id: string): RecordingMidiAdmission | undefined {
    if (!takeOwnsRecordingRoot()) {
        return undefined;
    }
    const admitted = activeRecordingRef.midiAdmissions.find((candidate) => candidate.id === id);
    return admitted && recordingCommitGroups.reconcileAdmission(admitted.clipId) ? admitted : undefined;
}
