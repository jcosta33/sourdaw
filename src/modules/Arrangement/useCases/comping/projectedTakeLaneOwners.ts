import { type AppAction, type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';

export function projectedTakeLaneOwners(priorActions: readonly AppAction[]): { id: string; trackId: string }[] {
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
    return lanes;
}
