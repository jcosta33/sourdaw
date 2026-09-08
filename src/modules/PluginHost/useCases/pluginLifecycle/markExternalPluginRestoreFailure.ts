import { externalPluginRestoreFailures } from './externalPluginRestoreFailures';
import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';

/** Publish a restore failure and retire every receipt from the preceding host state. */
export function markExternalPluginRestoreFailure(instanceId: string): void {
    externalPluginStateCaptureAuthority.invalidate(instanceId);
    externalPluginRestoreFailures.add(instanceId);
}
