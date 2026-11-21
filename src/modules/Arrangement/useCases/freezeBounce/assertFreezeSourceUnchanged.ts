import { computeFreezeSourceHash } from './computeFreezeSourceHash';
import { CHANGED_DURING_FREEZE } from './freezeChangedMessage';
import { type FreezeSources, readFreezeSources } from './freezeSourceTracks';
import { freezeSourceTracksMatch } from './freezeSourceTracksMatch';

function readLiveSources(trackId: string): FreezeSources {
    const sources = readFreezeSources(trackId);
    if (sources.tracks.length === 0) {
        throw new Error(CHANGED_DURING_FREEZE);
    }
    return sources;
}

/**
 * The render ran against the sources captured before its await, but edits that carry an unfrozen
 * stamp (agent batches, user edits) can land while the track is still "freezing". Committing the
 * take then would pin a buffer and hash to a source the track no longer has. Throws, so the freeze
 * ends as any failed render does: unfrozen, nothing cached.
 *
 * The sources are the target and every track its render reads, not the target alone. Hashing is
 * itself asynchronous, so they are re-read after the digest: a hash only counts for the clips and
 * devices it was taken from, and an edit or a routing change that landed meanwhile is hashed again.
 * Returns the live sources that were hashed, so a caller can tell whether they are still the live
 * ones once the returned promise settles.
 */
export async function assertFreezeSourceUnchanged(trackId: string, renderedSourceHash: string): Promise<FreezeSources> {
    let hashed = readLiveSources(trackId);
    for (;;) {
        const liveHash = await computeFreezeSourceHash(hashed);
        const current = readLiveSources(trackId);
        if (!freezeSourceTracksMatch(hashed, current)) {
            hashed = current;
            continue;
        }
        if (liveHash !== renderedSourceHash) {
            throw new Error(CHANGED_DURING_FREEZE);
        }
        return current;
    }
}
