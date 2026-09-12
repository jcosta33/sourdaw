import { notifyExternalPluginRestoreFailuresChanged } from '../../stores/externalPluginRestoreFailureStore';

import { externalPluginRestoreFailures, warnedExternalPluginRestoreFailures } from './externalPluginRestoreFailures';
import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';

/**
 * Record that authoritative state now exists for this instance — a restore of
 * its saved chunk succeeded, or an explicit `setExternalPluginState`
 * deliberately replaced it — so state capture reads the host again. The
 * already-warned entry goes with the marker: a NEW failure after this is a new
 * episode and warns again.
 */
export function clearExternalPluginRestoreFailure(instanceId: string): void {
    externalPluginStateCaptureAuthority.invalidate(instanceId);
    externalPluginRestoreFailures.delete(instanceId);
    warnedExternalPluginRestoreFailures.delete(instanceId);
    notifyExternalPluginRestoreFailuresChanged();
}
