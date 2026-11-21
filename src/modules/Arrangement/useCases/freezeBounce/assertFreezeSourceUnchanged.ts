import { computeTrackHash } from '../../services/computeTrackHash';
import { type Track, trackStore } from '../../stores/trackStore';

import { type FreezeMidiNoteSnapshot } from './freezeMidiNoteSnapshot';
import { freezeMidiNotesUnchanged } from './freezeMidiNotesUnchanged';

// Carries no "Freeze failed" prefix: the failure paths in freezeTrack add it where they need it.
const CHANGED_DURING_FREEZE = 'The track changed while it was freezing. Freeze it again.';

function findLiveTrack(trackId: string): Track {
    const liveTrack = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!liveTrack) {
        throw new Error(CHANGED_DURING_FREEZE);
    }
    return liveTrack;
}

/**
 * The render ran against the clips and device chain captured before its await, but edits that
 * carry an unfrozen stamp (agent batches, user edits) can land while the track is still
 * "freezing". Committing the take then would pin a buffer and hash to a source the track no
 * longer has. Throws, so the freeze ends as any failed render does: unfrozen, nothing cached.
 *
 * Hashing is itself asynchronous, so the track is re-read after the digest: a hash only counts
 * for the clips and devices it was taken from, and an edit that landed meanwhile is hashed again.
 */
export async function assertFreezeSourceUnchanged(
    trackId: string,
    renderedSourceHash: string,
    renderedMidiNotes: FreezeMidiNoteSnapshot
): Promise<void> {
    let hashed = findLiveTrack(trackId);
    for (;;) {
        const liveHash = await computeTrackHash(hashed.clips, hashed.devices);
        const current = findLiveTrack(trackId);
        if (current.clips !== hashed.clips || current.devices !== hashed.devices) {
            hashed = current;
            continue;
        }
        // MIDI note content is not part of the digest, and notes are written from routes the action
        // guards do not cover, so the commit is the one place every route has to pass.
        if (liveHash !== renderedSourceHash || !freezeMidiNotesUnchanged(renderedMidiNotes)) {
            throw new Error(CHANGED_DURING_FREEZE);
        }
        return;
    }
}
