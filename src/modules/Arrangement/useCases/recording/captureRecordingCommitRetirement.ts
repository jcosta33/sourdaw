import { recordingCommitGroups } from './recordingCommitGroup';

/** Capture the admitted slot before IO; stale terminals cannot retire a replacement. */
export function captureRecordingCommitRetirement(clipId: string): () => void {
    return recordingCommitGroups.captureRetirement(clipId);
}
