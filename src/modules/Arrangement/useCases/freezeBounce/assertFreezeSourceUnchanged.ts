import { computeTrackHash } from '../../services/computeTrackHash';
import { trackStore } from '../../stores/trackStore';

const CHANGED_DURING_FREEZE = 'Freeze failed: the track changed while it was freezing. Freeze it again.';

/**
 * The render ran against the clips and device chain captured before its await, but edits that
 * carry an unfrozen stamp (agent batches, user edits) can land while the track is still
 * "freezing". Committing the take then would pin a buffer and hash to a source the track no
 * longer has. Throws, so the freeze ends as any failed render does: unfrozen, nothing cached.
 */
export async function assertFreezeSourceUnchanged(trackId: string, renderedSourceHash: string): Promise<void> {
    const liveTrack = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!liveTrack) {
        throw new Error(CHANGED_DURING_FREEZE);
    }
    const liveHash = await computeTrackHash(liveTrack.clips, liveTrack.devices);
    if (liveHash !== renderedSourceHash) {
        throw new Error(CHANGED_DURING_FREEZE);
    }
}
