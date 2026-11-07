import { recordingCommitGroups } from './recordingCommitGroup';
import { recordingMidiBound } from './recordingMidiBound';

export function isRecordingMidiInputExcluded(audioTime: number, trackId?: string | null, clipId?: string): boolean {
    return (
        !recordingCommitGroups.reconcileAdmission(undefined, trackId) ||
        recordingMidiBound.excludes(audioTime, trackId, clipId)
    );
}
