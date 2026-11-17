import { type ClipSnapshot } from '../../events/arrangementClipSnapshots';

import { type LocatedClip } from './ShiftedOwnerState';

export function insertRestoredClips(
    clips: readonly LocatedClip[],
    trackId: string,
    clipIndex: number | undefined,
    restored: readonly ClipSnapshot[],
    trackIds: readonly string[]
): readonly LocatedClip[] {
    const ownerPositions = clips.flatMap((owner, index) => (owner.owningTrackId === trackId ? [index] : []));
    const slot = clipIndex === undefined ? ownerPositions.length : Math.min(clipIndex, ownerPositions.length);
    let insertionIndex: number;
    if (slot < ownerPositions.length) {
        insertionIndex = ownerPositions[slot]!;
    } else if (ownerPositions.length > 0) {
        insertionIndex = ownerPositions[ownerPositions.length - 1]! + 1;
    } else {
        const ownerOrder = trackIds.indexOf(trackId);
        const nextTrack = clips.findIndex((owner) => trackIds.indexOf(owner.owningTrackId) > ownerOrder);
        insertionIndex = nextTrack < 0 ? clips.length : nextTrack;
    }
    const next = [...clips];
    next.splice(insertionIndex, 0, ...restored.map((clip) => ({ owningTrackId: trackId, clip })));
    return next;
}
