import { type AppAction } from '#/utils/handlerContract';

import { projectedTakeLaneOwners } from '../comping/projectedTakeLaneOwners';
import { reKeyedTakeLaneOwnersMatchStore } from '../comping/reKeyedTakeLaneOwnersMatchStore';

import { clipSplitStateRestorable } from './clipSplitStateRestorable';
import { projectSplitRestore } from './projectSplitRestore';
import { type ShiftedOwnerState } from './ShiftedOwnerState';

export function projectSplitReplay(
    action: Extract<AppAction, { type: 'restoreClipSplitState' }>,
    state: ShiftedOwnerState
): ShiftedOwnerState | null {
    if (
        !state.tracks ||
        !clipSplitStateRestorable(action.payload, { tracks: state.tracks }) ||
        !reKeyedTakeLaneOwnersMatchStore(
            action.payload.reKeyedTakeLanes ?? [],
            action.payload.replacement.rightClip ? 'apply' : 'restore',
            [],
            state.takeLanes
        )
    ) {
        return null;
    }
    const restored = projectSplitRestore(state, action.payload);
    if (!restored) {
        return null;
    }
    return { ...restored, takeLanes: projectedTakeLaneOwners([action], restored.takeLanes) };
}
