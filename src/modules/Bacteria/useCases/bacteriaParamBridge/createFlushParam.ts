import {
    type BacteriaBatchEntry,
    type PersistDeviceParamFn,
    type ResolveEligibleDeviceWriteTargetFn,
    type UpdateDeviceParamFn,
} from './helpers';

export function createFlushParam(
    updateDeviceParamFn: UpdateDeviceParamFn,
    persistDeviceParamFn: PersistDeviceParamFn,
    resolveEligibleDeviceWriteTargetFn: ResolveEligibleDeviceWriteTargetFn
) {
    return function flushParam(_compositeKey: string, entry: BacteriaBatchEntry): void {
        const target = resolveEligibleDeviceWriteTargetFn(entry.deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        updateDeviceParamFn(target.trackId, target.deviceId, entry.key, entry.value);
        persistDeviceParamFn(target.deviceId, entry.key, entry.value);
    };
}
