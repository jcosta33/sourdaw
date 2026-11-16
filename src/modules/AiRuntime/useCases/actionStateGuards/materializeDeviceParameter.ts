import { normalizeDeviceParameterValueUnit } from '#/utils/deviceParameterValueUnit';

import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { type ProjectContextTrack } from '../../models/ProjectContext';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'setDeviceParameter' }>;

function hasDeviceParameterStateGuards(action: Action): boolean {
    return (
        action.payload.expectedTrackId !== undefined ||
        action.payload.expectedDeviceType !== undefined ||
        action.payload.expectedDeviceIds !== undefined ||
        action.payload.expectedValue !== undefined ||
        action.payload.expectedValuePresent !== undefined ||
        action.payload.expectedTrackFrozen !== undefined
    );
}

function getNativeParameterUnit(valueUnit: unknown, descriptorUnit: string) {
    if (valueUnit !== undefined) {
        return {};
    }
    const nativeUnit = normalizeDeviceParameterValueUnit(descriptorUnit);
    if (nativeUnit === null) {
        return {};
    }
    return { valueUnit: nativeUnit };
}

function matchesParameterBeforeValue(action: Action, value: number, valuePresent: boolean): boolean {
    if (action.payload.expectedValuePresent !== undefined && action.payload.expectedValuePresent !== valuePresent) {
        return false;
    }
    return action.payload.expectedValue === undefined || (valuePresent && action.payload.expectedValue === value);
}

function materializeGuardedParameter(
    action: Action,
    tracksById: ReadonlyMap<string, ProjectContextTrack>,
    deviceIdsByTrack: ReadonlyMap<string, string[]>
): MaterializationStep {
    const owners = Array.from(tracksById.values()).filter((track) =>
        track.devices.some((device) => device.id === action.payload.deviceId)
    );
    const owner = owners.length === 1 ? owners[0] : undefined;
    const device = owner?.devices.find((candidate) => candidate.id === action.payload.deviceId);
    const parameter = device?.parameters?.find((candidate) => candidate.id === action.payload.paramId);
    const valuePresent = parameter?.valuePresent !== false;
    if (
        !owner ||
        !device ||
        !parameter ||
        owner.frozen === true ||
        (action.payload.expectedTrackId !== undefined && action.payload.expectedTrackId !== owner.id) ||
        (action.payload.expectedDeviceType !== undefined && action.payload.expectedDeviceType !== device.type) ||
        !matchesParameterBeforeValue(action, parameter.value, valuePresent) ||
        (action.payload.expectedTrackFrozen !== undefined && action.payload.expectedTrackFrozen !== owner.frozen)
    ) {
        return {
            status: 'rejected',
            reason: `Device parameter state is unavailable or protected: ${action.payload.deviceId}/${action.payload.paramId}`,
        };
    }
    const expectedDeviceIds = deviceIdsByTrack.get(owner.id);
    if (!expectedDeviceIds) {
        return { status: 'rejected', reason: `Track is unavailable: ${owner.id}` };
    }
    return {
        status: 'accepted',
        actions: [
            {
                type: 'setDeviceParameter',
                payload: {
                    ...action.payload,
                    ...getNativeParameterUnit(action.payload.valueUnit, parameter.unit),
                    expectedDeviceIds: [...expectedDeviceIds],
                },
            },
        ],
    };
}

/** Pins a guarded parameter write to its device, owner and value; an unguarded write passes through. */
export function materializeDeviceParameter(action: Action, state: MaterializationState): MaterializationStep {
    if (!hasDeviceParameterStateGuards(action)) {
        return { status: 'accepted', actions: [action] };
    }
    return materializeGuardedParameter(action, state.tracksById, state.deviceIdsByTrack);
}
