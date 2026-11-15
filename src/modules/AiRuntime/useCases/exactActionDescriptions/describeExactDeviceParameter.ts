import { getPluginById } from '#/modules/Arrangement/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

import { formatParameterValue } from './formatParameterValue';
import { resolveActionTrackName } from './resolveActionTrackName';

type DeviceParameterAction = Extract<AppAction, { type: 'setDeviceParameter' }>;

function formatDescriptorParameterValue(value: number, unit: string, choices?: readonly string[]): string {
    const choice = Number.isInteger(value) ? choices?.[value] : undefined;
    if (choice) {
        return `"${choice}" (${String(value)})`;
    }
    return formatParameterValue(value, unit);
}

function describeProjectDeviceParameter(action: DeviceParameterAction, context: ProjectContext): string | null {
    const matchingTracks = context.tracks.filter((track) =>
        track.devices.some((device) => device.id === action.payload.deviceId)
    );
    let owner = matchingTracks.length === 1 ? matchingTracks[0] : undefined;
    if (action.payload.expectedTrackId !== undefined) {
        owner = matchingTracks.find((candidate) => candidate.id === action.payload.expectedTrackId);
    }
    const device = owner?.devices.find((candidate) => candidate.id === action.payload.deviceId);
    const parameter = device?.parameters?.find((candidate) => candidate.id === action.payload.paramId);
    const previousValue = action.payload.expectedValue ?? parameter?.value;
    if (!owner || !device || !parameter || previousValue === undefined) {
        return null;
    }
    const deviceName = device.name ?? device.type;
    return `Set "${owner.name}" (${owner.id}) device "${deviceName}" (${device.id}, ${device.type}) parameter "${parameter.name}" (${parameter.id}) from ${formatParameterValue(previousValue, parameter.unit)} to ${formatParameterValue(action.payload.value, parameter.unit)}`;
}

function describeCreatedDeviceParameter(
    action: DeviceParameterAction,
    context: ProjectContext,
    actions: readonly AppAction[]
): string | null {
    const createdDevice = actions.find(
        (candidate) => candidate.type === 'addDevice' && candidate.payload.deviceId === action.payload.deviceId
    );
    if (createdDevice?.type !== 'addDevice' || action.payload.expectedValue === undefined) {
        return null;
    }
    const trackName = resolveActionTrackName(createdDevice.payload.trackId, actions, context);
    const descriptor = getPluginById(createdDevice.payload.deviceType);
    const parameter = descriptor?.parameters.find((candidate) => candidate.id === action.payload.paramId);
    if (!parameter) {
        return null;
    }
    return `Set "${trackName}" (${createdDevice.payload.trackId}) device "${descriptor?.name ?? createdDevice.payload.deviceType}" (${action.payload.deviceId}, ${createdDevice.payload.deviceType}) parameter "${parameter.name}" (${parameter.id}) from ${formatDescriptorParameterValue(action.payload.expectedValue, parameter.unit, parameter.choices)} to ${formatDescriptorParameterValue(action.payload.value, parameter.unit, parameter.choices)}`;
}

/** The parameter write in words, read from the project or from the device the batch adds, else `null`. */
export function describeExactDeviceParameter(
    action: DeviceParameterAction,
    context: ProjectContext,
    actions: readonly AppAction[]
): string | null {
    return describeProjectDeviceParameter(action, context) ?? describeCreatedDeviceParameter(action, context, actions);
}
