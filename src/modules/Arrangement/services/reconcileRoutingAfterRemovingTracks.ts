import { type Track } from '../models/Track';

import { reconcileRoutingAfterRemoval } from './reconcileRoutingAfterRemoval';

type ReconcileRoutingAfterRemovingTracksInput = {
    /** Ids deleted one after another, in the order they are removed. */
    removedTrackIds: readonly string[];
    /** The project's tracks before any removal. */
    tracks: readonly Track[];
};

/**
 * The tracks that survive deleting `removedTrackIds` in sequence, routing
 * resolved the way each `removeTrack` leaves it: one removal at a time, each
 * reading the routing the previous one produced.
 */
export function reconcileRoutingAfterRemovingTracks({
    removedTrackIds,
    tracks,
}: ReconcileRoutingAfterRemovingTracksInput): Track[] {
    let current = [...tracks];
    for (const removedTrackId of removedTrackIds) {
        const removed = current.find((track) => track.id === removedTrackId);
        if (!removed) {
            continue;
        }
        current = reconcileRoutingAfterRemoval({
            removedTrackId,
            removedOutputId: removed.outputId,
            remainingTracks: current.filter((track) => track.id !== removedTrackId),
        }).tracks;
    }
    return current;
}
