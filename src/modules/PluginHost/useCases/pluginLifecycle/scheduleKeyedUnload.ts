import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';
import { loadedExternalInstances } from './loadedExternalInstances';
import { pendingKeyedUnloads } from './pendingKeyedUnloads';
import { serializePluginLifecycle } from './serializePluginLifecycle';

/** Run `unloadLoaded` on the instance's lifecycle turn, only while it is still loaded. */
export function scheduleKeyedUnload(instanceId: string, unloadLoaded: () => Promise<void>): Promise<void> {
    externalPluginStateCaptureAuthority.invalidate(instanceId);
    const unload = serializePluginLifecycle(instanceId, () => {
        if (!loadedExternalInstances.has(instanceId)) {
            return Promise.resolve();
        }
        return unloadLoaded();
    });
    pendingKeyedUnloads.track(instanceId, unload);
    return unload;
}
