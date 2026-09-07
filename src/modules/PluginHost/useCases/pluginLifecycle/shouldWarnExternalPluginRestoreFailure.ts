import { externalPluginRestoreFailures, warnedExternalPluginRestoreFailures } from './externalPluginRestoreFailures';

/**
 * Whether this save should still warn the user about the instance's unresolved
 * failed restore: exactly once per failure episode. Records the warning, so a
 * second save for the same unresolved failure stays silent; every
 * marker-resolve site drops the instance from the warned set, so a
 * resolved-then-refailed instance warns again.
 */
export function shouldWarnExternalPluginRestoreFailure(instanceId: string): boolean {
    if (!externalPluginRestoreFailures.has(instanceId)) {
        return false;
    }
    if (warnedExternalPluginRestoreFailures.has(instanceId)) {
        return false;
    }
    warnedExternalPluginRestoreFailures.add(instanceId);
    return true;
}
