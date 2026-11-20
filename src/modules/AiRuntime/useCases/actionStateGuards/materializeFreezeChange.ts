import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type FreezeAction = Extract<MaterializableRuntimeAction, { type: 'freezeTrack' | 'unfreezeTrack' }>;

/** A freeze change joins the batch as proposed; later members read the freeze state it leaves. */
export function materializeFreezeChange(action: FreezeAction, state: MaterializationState): MaterializationStep {
    if (state.frozenByTrack.has(action.payload.trackId)) {
        state.frozenByTrack.set(action.payload.trackId, action.type === 'freezeTrack');
    }
    return { status: 'accepted', actions: [action] };
}
