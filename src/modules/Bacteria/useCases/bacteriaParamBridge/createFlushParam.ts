import { type BacteriaBatchEntry, type PersistDeviceParamFn, type UpdateDeviceParamFn } from './helpers';

export function createFlushParam(updateDeviceParamFn: UpdateDeviceParamFn, persistDeviceParamFn: PersistDeviceParamFn) {
    return function flushParam(_compositeKey: string, entry: BacteriaBatchEntry): void {
        updateDeviceParamFn(entry.ref.trackId, entry.ref.deviceId, entry.key, entry.value);
        persistDeviceParamFn(entry.ref.deviceId, entry.key, entry.value);
    };
}
