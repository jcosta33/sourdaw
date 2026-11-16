import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';
import { unloadWithRetractedMirror } from './unloadWithRetractedMirror';

/**
 * Unload every instance and keep the carries, for a graph repair that commits
 * its own pre-teardown reads after the unload. Other whole-runtime unloads use
 * `unloadPlugin()`.
 */
export function unloadEveryPluginKeepingCarries(): Promise<void> {
    externalPluginStateCaptureAuthority.invalidateAll();
    return unloadWithRetractedMirror();
}
