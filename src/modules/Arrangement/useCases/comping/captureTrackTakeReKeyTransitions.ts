import { captureTakeReKeyTransitions } from './captureTakeReKeyTransitions';
import { collectTakeReKeyWindows } from './collectTakeReKeyWindows';
import { type TakeReKeyClipGeometry, type TakeReKeyLaneTransition } from './takeReKeyTransition';

type TakeReKeyOwnerProjection = {
    id: string;
    clips: readonly { source: TakeReKeyClipGeometry }[];
};

type TakeReKeyTrackProjection = {
    id: string;
    clips: readonly TakeReKeyClipGeometry[];
};

/**
 * The take-lane capture both delete routes share (#4841): project each
 * rewritten track's pre-operation clips and the prepared post-operation
 * state down to plain geometry, diff them into surviving-fragment windows —
 * the same transition the route's clip planning already committed to, so the
 * take transform cannot drift from the clip geometry — and capture how every
 * take and comp region follows. The routes differ only in which owners they
 * project and where the re-key targets come from; both stay local to the
 * route.
 */
export function captureTrackTakeReKeyTransitions(input: {
    owners: readonly TakeReKeyOwnerProjection[];
    afterTracks: readonly TakeReKeyTrackProjection[];
    reKeyTargets: ReadonlyMap<string, string>;
    removedClipIds: ReadonlySet<string>;
    deleteStartBeat: number;
    deleteEndBeat: number;
}): readonly TakeReKeyLaneTransition[] {
    const windowsByTrackId = collectTakeReKeyWindows({
        beforeTracks: input.owners.map((owner) => ({
            trackId: owner.id,
            clips: owner.clips.map((normalizedClip) => ({
                id: normalizedClip.source.id,
                startBeat: normalizedClip.source.startBeat,
                endBeat: normalizedClip.source.endBeat,
            })),
        })),
        afterTracks: input.afterTracks.map((track) => ({
            trackId: track.id,
            clips: track.clips.map((clip) => ({
                id: clip.id,
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
            })),
        })),
        reKeyTargets: input.reKeyTargets,
        deleteStartBeat: input.deleteStartBeat,
    });
    return captureTakeReKeyTransitions({
        windowsByTrackId,
        removedClipIds: input.removedClipIds,
        deleteStartBeat: input.deleteStartBeat,
        deleteEndBeat: input.deleteEndBeat,
    });
}
