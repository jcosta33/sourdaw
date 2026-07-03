import { type BridgeDeps, type DeviceRef, type GlutenBatchEntry } from './helpers';

type CreateFlushHandlersOutput = {
    flushParam: (_compositeKey: string, entry: GlutenBatchEntry) => void;
    pushParamImmediately: (ref: DeviceRef, key: string, value: number) => void;
};

export function createFlushHandlers(deps: BridgeDeps): CreateFlushHandlersOutput {
    function flushParam(_compositeKey: string, entry: GlutenBatchEntry): void {
        deps.updateDeviceParam(entry.ref.trackId, entry.ref.deviceId, entry.key, entry.value);
        deps.persistDeviceParam(entry.ref.deviceId, entry.key, entry.value);
    }

    function pushParamImmediately(ref: DeviceRef, key: string, value: number): void {
        deps.updateDeviceParam(ref.trackId, ref.deviceId, key, value);
        deps.persistDeviceParam(ref.deviceId, key, value);
    }

    return { flushParam, pushParamImmediately };
}
