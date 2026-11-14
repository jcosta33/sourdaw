import { nextDefaultTrackName } from '#/modules/Arrangement/useCases';

import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { createProjectedTrack } from '../../transformers/createProjectedTracks';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'addTrack' }>;

function readInitialDeviceIds(kind: string, initialDeviceId: string | undefined): string[] {
    if (kind === 'midi' && initialDeviceId !== undefined) {
        return [initialDeviceId];
    }
    return [];
}

export function materializeAddedTrack(action: Action, state: MaterializationState): MaterializationStep {
    const { tracksById, frozenByTrack, deviceIdsByTrack } = state;
    if (!action.payload.id) {
        return { status: 'accepted', actions: [action] };
    }
    if (tracksById.has(action.payload.id)) {
        return { status: 'rejected', reason: `Track identity is already in use: ${action.payload.id}` };
    }
    // A nameless track is pinned to the owner's default name for its kind among the
    // tracks projected so far, so the proposal, its guards and its replay name it once.
    const name = action.payload.name ?? nextDefaultTrackName(action.payload.kind, [...tracksById.values()]);
    tracksById.set(
        action.payload.id,
        createProjectedTrack(action.payload.id, name, action.payload.kind, action.payload.initialDeviceId)
    );
    deviceIdsByTrack.set(action.payload.id, readInitialDeviceIds(action.payload.kind, action.payload.initialDeviceId));
    frozenByTrack.set(action.payload.id, false);
    return {
        status: 'accepted',
        actions: [action.payload.name === undefined ? { ...action, payload: { ...action.payload, name } } : action],
    };
}
