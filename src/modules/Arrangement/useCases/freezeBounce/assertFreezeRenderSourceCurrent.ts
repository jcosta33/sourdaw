import { type Track, trackStore } from '../../stores/trackStore';

import { CHANGED_DURING_FREEZE } from './freezeChangedMessage';

/**
 * The digest is asynchronous, but the render reads the live track list when it is called, not the
 * track the freeze captured before the digest. A clip added while the digest was pending would be
 * rendered into the take, and if it is removed again before the commit the live source hashes as
 * it did at the start, so the commit-time source check cannot see it. Called synchronously right
 * before the render call, this refuses the freeze when the clips or devices the render will read
 * are not the ones that were hashed. Throws, so the freeze ends as any failed render does.
 */
export function assertFreezeRenderSourceCurrent(hashedTrack: Track): void {
    const liveTrack = trackStore.value?.tracks.find((candidate) => candidate.id === hashedTrack.id);
    if (!liveTrack || liveTrack.clips !== hashedTrack.clips || liveTrack.devices !== hashedTrack.devices) {
        throw new Error(CHANGED_DURING_FREEZE);
    }
}
