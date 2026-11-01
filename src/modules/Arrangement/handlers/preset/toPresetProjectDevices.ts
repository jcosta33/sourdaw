import { type DeviceSnapshot } from '#/utils/handlerContract';

import { type Device } from '../../stores/trackStore';

/** The project devices a preset load or its restoring inverse writes for a device-chain snapshot. */
export function toPresetProjectDevices(devices: readonly DeviceSnapshot[]): Device[] {
    return devices.map((device) => ({
        id: device.id,
        name: device.name,
        type: device.type,
        bypassed: device.bypassed,
        parameterValues: { ...device.parameterValues },
        ...(device.externalPluginId ? { externalPluginId: device.externalPluginId } : {}),
        ...(device.externalInstanceId ? { externalInstanceId: device.externalInstanceId } : {}),
        ...(device.externalStateChunk ? { externalStateChunk: device.externalStateChunk } : {}),
        ...(device.deviceState ? { deviceState: structuredClone(device.deviceState) } : {}),
    }));
}
