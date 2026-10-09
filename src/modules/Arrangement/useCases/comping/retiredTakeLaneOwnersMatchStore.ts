import { type AppAction, type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';

/**
 * A captured lane can be absent or replaced by a new lane for its track. Its
 * old id cannot name another track's lane: restoreTakesForClip resolves by id
 * as well as track. Preflight this before restoring any of the clip's owners,
 * including after hydration when a peer can have reused the retired identity.
 */
export function retiredTakeLaneOwnersMatchStore(
    retiredLanes: readonly RetiredTakeLaneSnapshot[],
    priorActions: readonly AppAction[] = []
): boolean {
    const lanes: { id: string; trackId: string }[] = takeLaneStore.value?.lanes.slice() ?? [];
    for (const action of priorActions) {
        let restored: readonly RetiredTakeLaneSnapshot[] | undefined;
        if (action.type === 'restoreClip') {
            restored = action.payload.retiredTakeLanes;
        } else if (action.type === 'restoreClipSplitState' && action.payload.replacement.rightClip) {
            restored = action.payload.retiredTakeLanes;
        }
        for (const { lane } of restored ?? []) {
            if (!lanes.some((live) => live.id === lane.id || live.trackId === lane.trackId)) {
                lanes.push(lane);
            }
        }
    }
    return retiredLanes.every(({ lane }) =>
        lanes.every((live) => live.id !== lane.id || live.trackId === lane.trackId)
    );
}
