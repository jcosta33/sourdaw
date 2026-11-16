import { clearReportedLatency } from '#/modules/AudioEngine/useCases';
import { unloadPluginCarryingLiveState } from '#/modules/PluginHost/useCases';

import { type HostedPluginInstance } from './collectHostedPluginInstances';

function describeFailure(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Releases the hosted plugin instances of a track an undone action created, once the document
 * write has committed. Each instance's live state is carried to the Redo that reactivates the
 * same instance id. Every instance is attempted so one failed teardown never strands the
 * others; failures are reported together afterwards.
 */
export async function unloadDiscardedHostedPlugins(instances: readonly HostedPluginInstance[]): Promise<void> {
    const failures: Error[] = [];
    for (const { deviceId, instanceId } of instances) {
        try {
            await unloadPluginCarryingLiveState(instanceId);
        } catch (error) {
            failures.push(
                new Error(`Plugin host teardown failed for instance ${instanceId}: ${describeFailure(error)}`)
            );
        }
        try {
            clearReportedLatency(deviceId);
        } catch (error) {
            failures.push(new Error(`Latency cleanup failed for device ${deviceId}: ${describeFailure(error)}`));
        }
    }
    if (failures.length > 0) {
        throw new AggregateError(failures, failures.map((failure) => failure.message).join('; '));
    }
}
