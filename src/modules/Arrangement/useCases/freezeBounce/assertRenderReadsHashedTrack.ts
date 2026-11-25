import { type Track, trackStore } from '../../stores/trackStore';

import { CHANGED_DURING_FREEZE } from './freezeChangedMessage';

/**
 * Synchronous, so nothing can run between it and the render's read of the live track list. Refuses
 * when an edit landed after the last hash, instead of hashing again, because hashing is async.
 */
export function assertRenderReadsHashedTrack(hashedTrack: Track): void {
    const liveTrack = trackStore.value?.tracks.find((candidate) => candidate.id === hashedTrack.id);
    if (!liveTrack || liveTrack.clips !== hashedTrack.clips || liveTrack.devices !== hashedTrack.devices) {
        throw new Error(CHANGED_DURING_FREEZE);
    }
}
