import { activeRecordingRef } from '../../stores/activeRecordingRef';

import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

export function retireRecordingMidiAdmission(id: string): void {
    if (!takeOwnsRecordingRoot()) {
        return;
    }
    activeRecordingRef.midiAdmissions = activeRecordingRef.midiAdmissions.filter((candidate) => candidate.id !== id);
}
