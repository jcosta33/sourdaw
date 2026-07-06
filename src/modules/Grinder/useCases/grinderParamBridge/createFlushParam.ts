import { type GrinderBatchEntry, type PersistDeviceParamFn, type UpdateDeviceParamFn } from './helpers';

type CreateFlushParamInput = {
    updateDeviceParamFn: UpdateDeviceParamFn;
    persistDeviceParamFn: PersistDeviceParamFn;
};

type CreateFlushParamOutput = (compositeKey: string, entry: GrinderBatchEntry) => void;

export function createFlushParam({
    updateDeviceParamFn,
    persistDeviceParamFn,
}: CreateFlushParamInput): CreateFlushParamOutput {
    return function flushParam(_compositeKey: string, entry: GrinderBatchEntry): void {
        updateDeviceParamFn(entry.ref.trackId, entry.ref.deviceId, entry.key, entry.value);
        persistDeviceParamFn(entry.ref.deviceId, entry.key, entry.value);
    };
}
