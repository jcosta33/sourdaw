import { type BridgeDeps, type CrustBatchEntry } from './helpers';

type CreateFlushHandlersOutput = {
    flushParam: (_compositeKey: string, entry: CrustBatchEntry) => void;
    pushParamImmediately: (deviceId: string, key: string, value: number) => void;
};

export function createFlushHandlers(deps: BridgeDeps): CreateFlushHandlersOutput {
    function flushParam(_compositeKey: string, entry: CrustBatchEntry): void {
        const target = deps.resolveEligibleDeviceWriteTarget(entry.deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        deps.updateDeviceParam(target.trackId, target.deviceId, entry.key, entry.value);
        deps.persistDeviceParam(target.deviceId, entry.key, entry.value);
    }

    function pushParamImmediately(deviceId: string, key: string, value: number): void {
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        deps.updateDeviceParam(target.trackId, target.deviceId, key, value);
        deps.persistDeviceParam(target.deviceId, key, value);
    }

    return { flushParam, pushParamImmediately };
}
