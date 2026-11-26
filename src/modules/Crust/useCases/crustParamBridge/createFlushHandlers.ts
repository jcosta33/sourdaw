import { type BridgeDeps, type CrustBatchEntry } from './helpers';

type CreateFlushHandlersOutput = {
    flushParam: (_compositeKey: string, entry: CrustBatchEntry) => void;
};

export function createFlushHandlers(deps: BridgeDeps): CreateFlushHandlersOutput {
    function flushParam(_compositeKey: string, entry: CrustBatchEntry): void {
        const target = deps.resolveEligibleDeviceWriteTarget(entry.deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        deps.updateDeviceParam(target.trackId, target.deviceId, entry.key, entry.value);
        deps.persistDeviceParam(target.deviceId, entry.key, entry.value);
        // Persisted after its style so the record's insertion order matches
        // the engine's own resolution order.
        if (entry.derivedAlgorithm !== undefined) {
            deps.persistDeviceParam(target.deviceId, 'algorithm', entry.derivedAlgorithm);
        }
    }

    return { flushParam };
}
