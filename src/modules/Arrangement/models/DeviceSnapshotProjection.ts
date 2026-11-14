import { type DeviceSnapshot } from '#/utils/handlerContract';

import { type Device } from './Track';

/** Detached project values for a declared device-chain snapshot. */
export function projectDeviceSnapshots(snapshots: readonly DeviceSnapshot[]): Device[] {
    return snapshots.map((snapshot) => {
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
    });
}
