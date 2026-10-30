import { type AppAction, type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { getTrackStoreState } from '../getTrackStoreState';

import { projectedTakeLaneOwners } from './projectedTakeLaneOwners';
import { regionsOverlap } from './regionsOverlap';

/**
 * A captured lane can be absent or replaced by a new lane for its track. Its
 * old id cannot name another track's lane: restoreTakesForClip resolves by id
 * as well as track. Preflight this before restoring any of the clip's owners,
 * including after hydration when a peer can have reused the retired identity.
 * Retired take ids are global too: a live occupant must still name the captured
 * clip inside the lane the restore will reconcile, never another peer's take.
 */
export function retiredTakeLaneOwnersMatchStore(
    retiredLanes: readonly RetiredTakeLaneSnapshot[],
    priorActions: readonly AppAction[] = []
): boolean {
    const lanes = projectedTakeLaneOwners(priorActions);
    const hostIds = new Set(getTrackStoreState()?.tracks.map((track) => track.id) ?? []);
    for (const action of priorActions) {
        if (action.type === 'removeTrack') {
            hostIds.delete(action.payload.trackId);
        } else if (action.type === 'restoreTrack') {
            hostIds.add(action.payload.trackId);
        } else if (action.type === 'removeAllTracks') {
            hostIds.clear();
        } else if (action.type === 'restoreTracks') {
            for (const restore of action.payload.restores) {
                hostIds.add(restore.trackId);
            }
        }
    }
    return retiredLanes.every(({ lane, retiredTakeIds, retiredBaseGapAudioSources }) => {
        const target = lanes.find((live) => live.id === lane.id || live.trackId === lane.trackId);
        const retiredTakes = lane.takes.filter((take) => retiredTakeIds?.includes(take.id));
        return (
            // The writer skips a missing recording host. Refuse the whole
            // restore instead of consuming history with only some takes back.
            (retiredTakes.length === 0 || hostIds.has(lane.trackId)) &&
            lanes.every((live) => live.id !== lane.id || live.trackId === lane.trackId) &&
            (retiredBaseGapAudioSources ?? []).every(
                (captured) =>
                    !(target?.baseGapAudioSources ?? []).some(
                        (tile) =>
                            tile.clipId === captured.clipId &&
                            regionsOverlap(tile, captured) &&
                            !valuesEqual(tile, captured)
                    )
            ) &&
            retiredTakes.every((captured) =>
                lanes.every((live) =>
                    live.takes.every(
                        (take) => take.id !== captured.id || (live === target && take.clipId === captured.clipId)
                    )
                )
            )
        );
    });
}
