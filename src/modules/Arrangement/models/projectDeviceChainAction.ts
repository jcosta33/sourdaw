import { type AppAction } from '#/utils/handlerContract';

import { type PluginDescriptor } from './DeviceParameterTypes';
import { clampDeviceParameterValue } from './DeviceParameterLaw';
import { projectDeviceSnapshots } from './projectDeviceSnapshots';
import { type Device } from './Track';

const DEVICE_ACTIONS = new Set<AppAction['type']>([
    'addDevice',
    'removeDevice',
    'reorderDevices',
    'restorePresetDeviceChain',
    'restoreDevice',
    'setDeviceParameter',
    'setDeviceState',
]);

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
    const devices = structuredClone(source);
    if (action.type === 'addDevice') {
        if (!action.payload.deviceId) {
            return devices;
        }
        const plugin = plugins.find(
            (candidate) =>
                candidate.id === action.payload.deviceType ||
                candidate.name.toLowerCase() === action.payload.deviceType.toLowerCase()
        );
        const parameterValues = { ...plugin?.internalParameterValues };
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
        const anchor = action.payload.afterDeviceId
            ? devices.findIndex((candidate) => candidate.id === action.payload.afterDeviceId)
            : devices.length - 1;
        devices.splice(anchor + 1, 0, device);
        return devices;
    }
    if (action.type === 'removeDevice') {
        return devices.filter((device) => device.id !== action.payload.deviceId);
    }
    if (action.type === 'reorderDevices') {
        const index = devices.findIndex((device) => device.id === action.payload.deviceId);
        if (index >= 0 && action.payload.targetIndex >= 0 && action.payload.targetIndex < devices.length) {
            const [device] = devices.splice(index, 1);
            if (device) {
                devices.splice(action.payload.targetIndex, 0, device);
            }
        }
        return devices;
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
