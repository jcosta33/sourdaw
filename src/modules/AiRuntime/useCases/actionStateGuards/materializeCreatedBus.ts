import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { createProjectedBus } from '../../transformers/createProjectedTracks';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'createBus' }>;

export function materializeCreatedBus(action: Action, state: MaterializationState): MaterializationStep {
    const { tracksById, deviceIdsByTrack, frozenByTrack } = state;
    if (!action.payload.busId) {
        return { status: 'accepted', actions: [action] };
    }
    if (tracksById.has(action.payload.busId)) {
        return { status: 'rejected', reason: `Bus identity is already in use: ${action.payload.busId}` };
    }
    tracksById.set(action.payload.busId, createProjectedBus(action.payload.busId, action.payload.name));
    deviceIdsByTrack.set(action.payload.busId, []);
    frozenByTrack.set(action.payload.busId, false);
    return { status: 'accepted', actions: [action] };
}
