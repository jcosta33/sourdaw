import { refuseFreezeCommitWhileRecording } from './refuseFreezeCommitWhileRecording';

/**
 * Returns whether the finished render must not commit: its task was superseded or cancelled, or a
 * recording start is engaged on the track, which it warns about. Synchronous, so a caller that writes
 * straight after it leaves no turn in which a recording start could land.
 */
export function refuseFreezeCommit(trackId: string, isCurrentTask: () => boolean): boolean {
    if (!isCurrentTask()) {
        return true;
    }
    return refuseFreezeCommitWhileRecording(trackId);
}
