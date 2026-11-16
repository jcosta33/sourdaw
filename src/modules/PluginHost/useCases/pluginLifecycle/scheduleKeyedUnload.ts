import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';
import { loadedExternalInstances } from './loadedExternalInstances';
import { serializePluginLifecycle } from './serializePluginLifecycle';

/** Run `unloadLoaded` on the instance's lifecycle turn, only while it is still loaded. */
export function scheduleKeyedUnload(instanceId: string, unloadLoaded: () => Promise<void>): Promise<void> {
    externalPluginStateCaptureAuthority.invalidate(instanceId);
    return serializePluginLifecycle(instanceId, () => {
        if (!loadedExternalInstances.has(instanceId)) {
            return Promise.resolve();
        }
        return unloadLoaded();
    });
}
