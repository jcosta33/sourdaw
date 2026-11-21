import { clearReportedLatency } from '#/modules/AudioEngine/useCases';
import { unloadPluginCarryingLiveState } from '#/modules/PluginHost/useCases';

import { type HostedPluginInstance } from './collectHostedPluginInstances';

function describeFailure(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Releases the hosted plugin instances of a track that left the project (a removal, or an undone
 * creation), once the document write has committed. The native unload closes each editor before
 * releasing its instance. Each instance's live state is carried to the Undo or Redo that
 * reactivates the same instance id. Every unload is queued at once, while the caller's check that the
 * track is gone still holds, so a restore landing during any of them waits for that unload and reloads
 * from its carry. One failed teardown never strands the others; failures are reported together afterwards.
 */
async function releaseInstance({ deviceId, instanceId }: HostedPluginInstance): Promise<Error[]> {
    const failures: Error[] = [];
    try {
        await unloadPluginCarryingLiveState(instanceId);
    } catch (error) {
        failures.push(new Error(`Plugin host teardown failed for instance ${instanceId}: ${describeFailure(error)}`));
    }
    try {
        clearReportedLatency(deviceId);
    } catch (error) {
        failures.push(new Error(`Latency cleanup failed for device ${deviceId}: ${describeFailure(error)}`));
    }
    return failures;
}

export async function unloadDiscardedHostedPlugins(instances: readonly HostedPluginInstance[]): Promise<void> {
    const failures = (await Promise.all(instances.map(releaseInstance))).flat();
    if (failures.length > 0) {
        throw new AggregateError(failures, failures.map((failure) => failure.message).join('; '));
    }
}
