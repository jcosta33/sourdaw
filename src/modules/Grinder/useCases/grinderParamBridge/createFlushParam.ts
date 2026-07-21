import {
    type GrinderBatchEntry,
    type PersistDeviceParamFn,
    type ResolveEligibleDeviceWriteTargetFn,
    type UpdateDeviceParamFn,
} from './helpers';

type CreateFlushParamInput = {
    updateDeviceParamFn: UpdateDeviceParamFn;
    persistDeviceParamFn: PersistDeviceParamFn;
    resolveEligibleDeviceWriteTargetFn: ResolveEligibleDeviceWriteTargetFn;
};

type CreateFlushParamOutput = (compositeKey: string, entry: GrinderBatchEntry) => void;

export function createFlushParam({
    updateDeviceParamFn,
    persistDeviceParamFn,
    resolveEligibleDeviceWriteTargetFn,
}: CreateFlushParamInput): CreateFlushParamOutput {
    return function flushParam(_compositeKey: string, entry: GrinderBatchEntry): void {
        const target = resolveEligibleDeviceWriteTargetFn(entry.deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        updateDeviceParamFn(target.trackId, target.deviceId, entry.key, entry.value);
        persistDeviceParamFn(target.deviceId, entry.key, entry.value);
    };
}
