import { externalPluginRestoreFailures } from './externalPluginRestoreFailures';

/**
 * Whether this instance still carries an unresolved failed state restore, so
 * its current runtime state is plugin defaults rather than authoritative data.
 */
export function hasUnresolvedExternalPluginRestoreFailure(instanceId: string): boolean {
    return externalPluginRestoreFailures.has(instanceId);
}
