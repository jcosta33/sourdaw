import { type DeviceNodeEntry } from '../buildDeviceChain';

export function collectDeviceRuntimeFailures(deviceEntriesByTrack: ReadonlyMap<string, readonly DeviceNodeEntry[]>): {
    runtimeFailures: Promise<never>[];
    runtimeHealthChecks: Array<() => Promise<void>>;
} {
    const failures: Promise<never>[] = [];
    const healthChecks: Array<() => Promise<void>> = [];
    for (const entries of deviceEntriesByTrack.values()) {
        for (const entry of entries) {
            if (entry.strategy.runtimeFailure) {
                failures.push(entry.strategy.runtimeFailure);
            }
            if (entry.strategy.runtimeHealthCheck) {
                healthChecks.push(entry.strategy.runtimeHealthCheck);
            }
        }
    }
    return { runtimeFailures: failures, runtimeHealthChecks: healthChecks };
}
