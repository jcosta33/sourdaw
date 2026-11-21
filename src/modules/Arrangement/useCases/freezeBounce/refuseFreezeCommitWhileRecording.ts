import { notifyUser } from '#/utils/Notification/notifyUser';

import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';
import {
    FREEZE_REFUSED_WHILE_RECORDING_MESSAGE,
    isFreezeRefusedWhileRecording,
} from '../../handlers/track/isFreezeRefusedWhileRecording';

import { restoreCancelledFreeze } from './restoreCancelledFreeze';

/**
 * The commit-time twin of the action's start gate: a freeze that began with the transport idle keeps
 * rendering when Record is pressed, and committing then would freeze a track the start needs as its
 * take target. Settles the track back to its pre-freeze state and warns once. Returns whether it refused.
 */
export function refuseFreezeCommitWhileRecording(input: {
    trackId: string;
    pendingFreeze: FreezeStateSnapshot | null;
    settled: FreezeStateSnapshot;
    scope: (write: () => void) => void;
}): boolean {
    if (!isFreezeRefusedWhileRecording(input.trackId)) {
        return false;
    }
    restoreCancelledFreeze(input);
    notifyUser(FREEZE_REFUSED_WHILE_RECORDING_MESSAGE, 'warning');
    return true;
}
