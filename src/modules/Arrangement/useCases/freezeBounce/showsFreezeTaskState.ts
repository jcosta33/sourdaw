import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';
import { type Track } from '../../stores/trackStore';

import { freezeStateSnapshotMatches } from './freezeStateSnapshotMatches';

/**
 * Whether a track still shows a freeze state its running freeze can legitimately see: the freezing
 * state the freeze wrote, or the settled state it started from. An inbound document change rebases the
 * freeze's uncommitted write away, so the live track reads the settled state again while the freeze is
 * still current. Any other freeze state was written by something else, local or remote.
 */
export function showsFreezeTaskState(
    track: Track,
    states: { pendingFreeze: FreezeStateSnapshot; previousFreeze: FreezeStateSnapshot }
): boolean {
    return (
        freezeStateSnapshotMatches(track, states.pendingFreeze) ||
        freezeStateSnapshotMatches(track, states.previousFreeze)
    );
}
