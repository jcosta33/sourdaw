import { type ClipStateSnapshot } from '#/utils/handlerContract';

import { type Clip } from '../stores/trackStore';

/**
 * The subset of an operation's `next`/`previous` snapshot that
 * `insertReplacementClips` needs to splice a replacement clip set back into a
 * track's clip array at the right position. Shared by every clip-identity
 * operation (glue, strip silence, …) that swaps a set of clips for another
 * set in place rather than editing clips individually.
 */
export type ClipReplacementSnapshot = {
    readonly clips: readonly ClipStateSnapshot[];
    readonly clipOrder: readonly string[];
};

export function cloneSnapshotClip(snapshot: ClipStateSnapshot): Clip {
    return {
        ...structuredClone(snapshot),
        overrides: snapshot.overrides ? { ...snapshot.overrides } : undefined,
        kneadState: snapshot.kneadState
            ? {
                  ...snapshot.kneadState,
                  blobs: snapshot.kneadState.blobs.map((blob) => ({
                      ...blob,
                      pitchCurveCents: [...blob.pitchCurveCents],
                  })),
              }
            : undefined,
    };
}

/**
 * Replace every clip named in `affectedClipIds` with the clips named in
 * `replacement`, preserving the affected set's original position in the
 * track's clip array. Used both forward (apply) and backward (undo) — the
 * caller passes `replacement` as whichever side of the transition it wants
 * written.
 */
export function insertReplacementClips({
    affectedClipIds,
    currentClips,
    replacement,
}: {
    affectedClipIds: readonly string[];
    currentClips: readonly Clip[];
    replacement: ClipReplacementSnapshot;
}): Clip[] {
    const currentAffectedIndexes = currentClips.flatMap((clip, index) =>
        affectedClipIds.includes(clip.id) ? [index] : []
    );
    const insertionAnchor = currentAffectedIndexes[0] ?? currentClips.length;
    const clips = currentClips.filter((clip) => !affectedClipIds.includes(clip.id));
    const replacementById = new Map(replacement.clips.map((clip) => [clip.id, clip]));
    let insertedReplacement = false;
    for (const clipId of replacement.clipOrder) {
        const replacementClip = replacementById.get(clipId);
        if (!replacementClip) {
            continue;
        }
        const orderIndex = replacement.clipOrder.indexOf(clipId);
        const precedingId = replacement.clipOrder
            .slice(0, orderIndex)
            .toReversed()
            .find((candidateId) => clips.some((clip) => clip.id === candidateId));
        const followingId = replacement.clipOrder
            .slice(orderIndex + 1)
            .find((candidateId) => clips.some((clip) => clip.id === candidateId));
        let insertionIndex = Math.min(insertionAnchor, clips.length);
        if (!insertedReplacement) {
            insertedReplacement = true;
        } else if (precedingId) {
            insertionIndex = clips.findIndex((clip) => clip.id === precedingId) + 1;
        } else if (followingId) {
            insertionIndex = Math.min(
                insertionIndex,
                clips.findIndex((clip) => clip.id === followingId)
            );
        }
        clips.splice(insertionIndex, 0, cloneSnapshotClip(replacementClip));
    }
    return clips;
}
