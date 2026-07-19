import { trackStore } from '../../stores/trackStore';

import { freezeTaskAuthority } from './freezeTaskAuthority';
import { stabilizeInterruptedFreeze } from './stabilizeInterruptedFreeze';

export function cancelFreezeTasksForProjectTransition(): Promise<void> {
    const revoked = freezeTaskAuthority.revoke();
    const trackState = trackStore.value;
    if (trackState && revoked.trackIds.length > 0) {
        const revokedTrackIds = new Set(revoked.trackIds);
        const tracks = trackState.tracks.map((track) =>
            revokedTrackIds.has(track.id) ? stabilizeInterruptedFreeze(track) : track
        );
        if (tracks.some((track, index) => track !== trackState.tracks[index])) {
            trackStore.set({ ...trackState, tracks });
        }
    }
    return revoked.settled;
}
