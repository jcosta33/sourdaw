import { type AppAction } from '#/utils/handlerContract';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';
import { valuesEqual } from '#/utils/structuralEquality';

import { projectCapturedDevicePatch } from './CapturedDevicePatchProjection';
import { clampDeviceParameterValue } from './DeviceParameterLaw';
import { type PluginDescriptor } from './DeviceParameterTypes';
import { type DevicePatchState } from './DevicePatchState';
import { projectDeviceSnapshots } from './DeviceSnapshotProjection';
import { projectsDeviceChainByActionType } from './ProjectsDeviceChainByActionType';
import { type Device } from './Track';

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

function projectFermenterPatch(devices: Device[], action: Extract<AppAction, { type: 'setFermenterPatch' }>): Device[] {
    const index = devices.findIndex((device) => device.id === action.payload.deviceId);
    const current = devices[index];
    const next =
        current && projectCapturedDevicePatch(current, action.payload.expectedProject, action.payload.afterProject);
    if (next) {
        devices[index] = next;
    }
    return devices;
}

type FactoryPatchProjection = {
    deviceId: string;
    deviceIds: readonly string[];
    deviceType: string;
    before: DevicePatchState;
    after: DevicePatchState;
};

function projectFactoryPatch(
    devices: Device[],
    { deviceId, deviceIds, deviceType, before, after }: FactoryPatchProjection
): Device[] | null {
    const index = devices.findIndex((device) => device.id === deviceId);
    const current = devices[index];
    if (
        current?.type !== deviceType ||
        !valuesEqual(
            devices.map((device) => device.id),
            deviceIds
        )
    ) {
        return null;
    }
    const next = projectCapturedDevicePatch(current, before, after);
    if (!next) {
        return null;
    }
    devices[index] = next;
    return devices;
}

function projectToasterFactoryKit(
    devices: Device[],
    action: Extract<AppAction, { type: 'setToasterFactoryKit' }>
): Device[] | null {
    const { deviceId, deviceIds, before, after } = action.payload;
    return projectFactoryPatch(devices, {
        deviceId,
        deviceIds,
        deviceType: DEVICE_TYPE_IDS.toaster,
        before: { deviceState: before, parameterValues: {} },
        after: { deviceState: after, parameterValues: {} },
    });
}

function projectDeviceParameter(
    device: Device | undefined,
    { paramId, value, deleteParameter }: Extract<AppAction, { type: 'setDeviceParameter' }>['payload']
): void {
    if (!device) {
        return;
    }
    if (deleteParameter) {
        delete device.parameterValues[paramId];
        return;
    }
    device.parameterValues[paramId] = clampDeviceParameterValue({ deviceType: device.type, paramId, value });
}

/** Shared owner projection of the existing device-chain command rules; never writes a store. */
export function projectDeviceChainAction(
    trackId: string,
    source: readonly Device[],
    action: AppAction,
    plugins: readonly PluginDescriptor[]
): Device[] | null {
    if (!Object.hasOwn(projectsDeviceChainByActionType, action.type) || !projectsDeviceChainByActionType[action.type]) {
        return null;
    }
    if (action.payload && 'trackId' in action.payload && action.payload.trackId !== trackId) {
        return null;
    }
    const devices = source.map((device) => structuredClone(device));
    if (action.type === 'setFermenterPatch') {
        return projectFermenterPatch(devices, action);
    }
    if (action.type === 'setToasterFactoryKit') {
        return projectToasterFactoryKit(devices, action);
    }
    if (action.type === 'setBacteriaFactoryPatch') {
        return projectFactoryPatch(devices, { ...action.payload, deviceType: DEVICE_TYPE_IDS.bacteria });
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
        projectDeviceParameter(
            devices.find((candidate) => candidate.id === action.payload.deviceId),
            action.payload
        );
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
