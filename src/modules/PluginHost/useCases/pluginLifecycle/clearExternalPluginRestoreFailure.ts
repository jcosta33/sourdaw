import { externalPluginRestoreFailures } from './externalPluginRestoreFailures';

/**
 * Record that authoritative state now exists for this instance — a restore of
 * its saved chunk succeeded, or an explicit `setExternalPluginState`
 * deliberately replaced it — so state capture reads the host again.
 */
export function clearExternalPluginRestoreFailure(instanceId: string): void {
    externalPluginRestoreFailures.delete(instanceId);
}
