import { type HandlerValidationContext } from '#/utils/handlerContract';

import { planDevicePatchWrite } from '../../models/DevicePatchWritePlan';
import { readPlannedDeviceOwnerSource } from '../../models/PlannedDeviceOwnerSource';
import { type PlannedDevicePresence, type PlannedDeviceWriteStep } from '../../models/PlannedDeviceWrite';
import { getPlatformPlugins } from '../getPlatformPlugins';
import { getTrackStoreState } from '../getTrackStoreState';

type Input = {
    deviceId: string;
    trackId?: string;
    parameterIds: readonly string[];
    context?: HandlerValidationContext;
};

function adaptPriorSiblingActions(
    context: HandlerValidationContext | undefined,
    trackIds: Set<string>
): PlannedDeviceWriteStep[] | null {
    const steps: PlannedDeviceWriteStep[] = [];
    for (const action of context?.actions.slice(0, context.actionIndex) ?? []) {
        if (action.type === 'setFermenterPatch') {
            steps.push({
                kind: 'patch',
                trackId: action.payload.expectedTrackId,
                deviceId: action.payload.deviceId,
                expectedDeviceIds: action.payload.expectedDeviceIds,
                expectedTrackFrozen: action.payload.expectedTrackFrozen,
                expected: action.payload.expectedProject,
                after: action.payload.afterProject,
            });
        } else if (action.type === 'restoreTrack') {
            const owner = readPlannedDeviceOwnerSource(action.payload.trackSnapshot);
            if (!owner || owner.id !== action.payload.trackId) {
                return null;
            }
            trackIds.add(owner.id);
            steps.push({ kind: 'restore-owner', source: owner });
        } else {
            if (action.type === 'addTrack' && action.payload.id) {
                trackIds.add(action.payload.id);
            }
            if (action.type === 'createBus' && action.payload.busId) {
                trackIds.add(action.payload.busId);
            }
            steps.push({ kind: 'command', action });
        }
    }
    return steps;
}

/** Plan only prior siblings from the initial projection; execution checks its actual midpoint separately. */
export function getPlannedDevicePatchState(input: Input): Extract<PlannedDevicePresence, { kind: 'device' }> | null {
    const source = (getTrackStoreState()?.tracks ?? []).map(readPlannedDeviceOwnerSource);
    if (source.some((owner) => owner === null)) {
        return null;
    }
    const owners = source.filter((owner) => owner !== null);
    const trackIds = new Set(owners.map((owner) => owner.id));
    const steps = adaptPriorSiblingActions(input.context, trackIds);
    if (!steps) {
        return null;
    }
    const matches: Array<Extract<PlannedDevicePresence, { kind: 'device' }>> = [];
    for (const trackId of input.trackId ? [input.trackId] : trackIds) {
        const planned = planDevicePatchWrite({
            source: owners,
            trackId,
            deviceId: input.deviceId,
            parameterIds: input.parameterIds,
            steps,
            actionIndex: steps.length,
            plugins: getPlatformPlugins(),
        });
        if (planned.status === 'ready' && planned.prefix.kind === 'device') {
            matches.push(planned.prefix);
        }
    }
    return matches.length === 1 ? (matches[0] ?? null) : null;
}
