import { CHANGED_DURING_FREEZE } from './freezeChangedMessage';
import { type FreezeSources, readFreezeSources } from './freezeSourceTracks';
import { freezeSourceTracksMatch } from './freezeSourceTracksMatch';

/**
 * Synchronous, so nothing can run between it and the render's read of the live track list. Refuses
 * when an edit or a routing change landed after the last hash, instead of hashing again, because
 * hashing is async.
 */
export function assertRenderReadsHashedTrack(trackId: string, hashedSources: FreezeSources): void {
    const liveSources = readFreezeSources(trackId);
    if (!freezeSourceTracksMatch(hashedSources, liveSources)) {
        throw new Error(CHANGED_DURING_FREEZE);
    }
}
