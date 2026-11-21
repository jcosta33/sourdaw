import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'removeDevice' }>;

export function materializeRemovedDevice(action: Action, state: MaterializationState): MaterializationStep {
    const owners = Array.from(state.tracksById.values()).filter((track) =>
        track.devices.some((device) => device.id === action.payload.deviceId)
    );
    const owner = owners.length === 1 ? owners[0] : undefined;
    if (!owner) {
        return { status: 'accepted', actions: [action] };
    }
    const frozen = state.frozenByTrack.get(owner.id) ?? false;
    if (frozen) {
        return { status: 'rejected', reason: `Track is frozen: ${owner.id}` };
    }
    return {
        status: 'accepted',
        actions: [{ type: 'removeDevice', payload: { ...action.payload, expectedFrozen: frozen } }],
    };
}
