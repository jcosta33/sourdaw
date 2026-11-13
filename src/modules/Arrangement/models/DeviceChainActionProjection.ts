import { type AppAction } from '#/utils/handlerContract';

import { projectCapturedDevicePatch } from './CapturedDevicePatchProjection';
import { clampDeviceParameterValue } from './DeviceParameterLaw';
import { type PluginDescriptor } from './DeviceParameterTypes';
import { projectDeviceSnapshots } from './DeviceSnapshotProjection';
import { type Device } from './Track';

const DEVICE_ACTIONS = new Set<AppAction['type']>([
    'addDevice',
    'removeDevice',
    'reorderDevices',
    'restorePresetDeviceChain',
    'restoreDevice',
    'setDeviceParameter',
    'setDeviceState',
    'setFermenterPatch',
]);

function projectAddedDevice(
    chain: Device[],
    action: Extract<AppAction, { type: 'addDevice' }>,
    plugins: readonly PluginDescriptor[]
): Device[] {
    if (!action.payload.deviceId) {
        return chain;
    }
    const plugin = plugins.find(
        (candidate) =>
            candidate.id === action.payload.deviceType ||
            candidate.name.toLowerCase() === action.payload.deviceType.toLowerCase()
    );
    const parameterValues = Object.fromEntries<number>(Object.entries(plugin?.internalParameterValues ?? {}));
    for (const parameter of plugin?.parameters ?? []) {
        parameterValues[parameter.id] = parameter.value;
    }
    const device: Device = {
        id: action.payload.deviceId,
        name: plugin?.name ?? action.payload.deviceType,
        type: plugin?.id ?? action.payload.deviceType,
        bypassed: false,
        parameterValues,
    };
    let anchor = chain.length - 1;
    if (action.payload.afterDeviceId) {
        anchor = chain.findIndex((candidate) => candidate.id === action.payload.afterDeviceId);
    }
    chain.splice(anchor + 1, 0, device);
    return chain;
}

function projectReorderedDevice(chain: Device[], action: Extract<AppAction, { type: 'reorderDevices' }>): Device[] {
    const index = chain.findIndex((device) => device.id === action.payload.deviceId);
    if (index >= 0 && action.payload.targetIndex >= 0 && action.payload.targetIndex < chain.length) {
        const [device] = chain.splice(index, 1);
        if (device) {
            chain.splice(action.payload.targetIndex, 0, device);
        }
    }
    return chain;
}

/** Shared owner projection of the existing device-chain command rules; never writes a store. */
export function projectDeviceChainAction(
    trackId: string,
    source: readonly Device[],
    action: AppAction,
    plugins: readonly PluginDescriptor[]
): Device[] | null {
    if (!DEVICE_ACTIONS.has(action.type)) {
        return null;
    }
    if (action.payload && 'trackId' in action.payload && action.payload.trackId !== trackId) {
        return null;
    }
    const devices = source.map((device) => structuredClone(device));
    if (action.type === 'setFermenterPatch') {
        const index = devices.findIndex((device) => device.id === action.payload.deviceId);
        const current = devices[index];
        const next =
            current && projectCapturedDevicePatch(current, action.payload.expectedProject, action.payload.afterProject);
        if (next) {
            devices[index] = next;
        }
        return devices;
    }
    if (action.type === 'addDevice') {
        return projectAddedDevice(devices, action, plugins);
    }
    if (action.type === 'removeDevice') {
        return devices.filter((device) => device.id !== action.payload.deviceId);
    }
    if (action.type === 'reorderDevices') {
        return projectReorderedDevice(devices, action);
    }
    if (action.type === 'restorePresetDeviceChain') {
        return projectDeviceSnapshots(action.payload.replacementDevices);
    }
    if (action.type === 'restoreDevice') {
        devices.splice(action.payload.deviceIndex, 0, structuredClone(action.payload.deviceSnapshot));
        return devices;
    }
    if (action.type === 'setDeviceParameter') {
        const device = devices.find((candidate) => candidate.id === action.payload.deviceId);
        if (device) {
            if (action.payload.deleteParameter) {
                delete device.parameterValues[action.payload.paramId];
            } else {
                device.parameterValues[action.payload.paramId] = clampDeviceParameterValue({
                    deviceType: device.type,
                    paramId: action.payload.paramId,
                    value: action.payload.value,
                });
            }
        }
        return devices;
    }
    if (action.type === 'setDeviceState') {
        const device = devices.find((candidate) => candidate.id === action.payload.deviceId);
        if (device) {
            device.deviceState = structuredClone(action.payload.state);
        }
        return devices;
    }
    return null;
}
