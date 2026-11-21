import { assertFreezeSourceUnchanged } from './assertFreezeSourceUnchanged';
import { refuseFreezeCommitWhileRecording } from './refuseFreezeCommitWhileRecording';

/**
 * The checks between a finished render and its commit write. Returns whether the freeze may commit;
 * throws when the source changed while it rendered. The caller writes synchronously after it, so no
 * note or recording start can land between the last check and the write.
 */
export async function confirmFreezeCommit(
    trackId: string,
    renderedSourceHash: string,
    isCurrentTask: () => boolean
): Promise<boolean> {
    // Decided before the source check: a running take's own provisional clip is in the track,
    // so the check would report the track as edited instead of refusing the freeze.
    if (refuseFreezeCommitWhileRecording(trackId)) {
        return false;
    }
    try {
        await assertFreezeSourceUnchanged(trackId, renderedSourceHash);
    } catch (error) {
        if (!isCurrentTask()) {
            throw error;
        }
        // A recording start landing during the source check ends it as an edit, not as a failure.
        if (refuseFreezeCommitWhileRecording(trackId)) {
            return false;
        }
        throw error;
    }
    if (!isCurrentTask()) {
        return false;
    }
    return !refuseFreezeCommitWhileRecording(trackId);
}
