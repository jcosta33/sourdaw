import { notifyUser } from '#/utils/Notification/notifyUser';

import { FREEZE_REFUSED_WHILE_RECORDING_MESSAGE, isFreezeRefusedWhileRecording } from './isFreezeRefusedWhileRecording';

/**
 * The commit-time twin of the action's start gate: a freeze that began with the transport idle keeps
 * rendering when Record is pressed, and committing then would freeze a track the start needs as its
 * take target. Warns once and returns whether it refused; the caller exits without a write, which
 * aborts the action's transaction and returns the track to its committed state.
 */
export function refuseFreezeCommitWhileRecording(trackId: string): boolean {
    if (!isFreezeRefusedWhileRecording(trackId)) {
        return false;
    }
    notifyUser(FREEZE_REFUSED_WHILE_RECORDING_MESSAGE, 'warning');
    return true;
}
