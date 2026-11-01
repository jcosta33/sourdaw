import { type DeviceSnapshot } from '#/utils/handlerContract';

import { type Device } from '../../stores/trackStore';

/**
 * The project device a preset load or its restoring inverse writes for one
 * snapshot. Mutable values are cloned: the snapshot lives on in recorded undo
 * and redo actions, and the batch projection edits parameters in place.
 */
function toPresetProjectDevice(snapshot: DeviceSnapshot): Device {
    const device: Device = {
        id: snapshot.id,
        name: snapshot.name,
        type: snapshot.type,
        bypassed: snapshot.bypassed,
        parameterValues: structuredClone(snapshot.parameterValues),
    };
    if (snapshot.externalPluginId) {
        device.externalPluginId = snapshot.externalPluginId;
    }
    if (snapshot.externalInstanceId) {
        device.externalInstanceId = snapshot.externalInstanceId;
    }
    if (snapshot.externalStateChunk) {
        device.externalStateChunk = snapshot.externalStateChunk;
    }
    if (snapshot.deviceState) {
        device.deviceState = structuredClone(snapshot.deviceState);
    }
    return device;
}

/** The project devices a preset load or its restoring inverse writes for a device-chain snapshot. */
export function toPresetProjectDevices(devices: readonly DeviceSnapshot[]): Device[] {
    return devices.map(toPresetProjectDevice);
}
