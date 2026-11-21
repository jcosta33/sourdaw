import { type Track } from '../../stores/trackStore';

import { CHANGED_DURING_FREEZE } from './freezeChangedMessage';
import { freezeSourceTracksMatch } from './freezeSourceTracksMatch';
import { selectLiveFreezeSourceTracks } from './selectLiveFreezeSourceTracks';

/**
 * Synchronous, so nothing can run between it and the render's read of the live track list. Refuses
 * when an edit or a routing change landed after the last hash, instead of hashing again, because
 * hashing is async.
 */
export function assertRenderReadsHashedTrack(trackId: string, hashedSources: Track[]): void {
    const liveSources = selectLiveFreezeSourceTracks(trackId);
    if (!freezeSourceTracksMatch(hashedSources, liveSources)) {
        throw new Error(CHANGED_DURING_FREEZE);
    }
}
