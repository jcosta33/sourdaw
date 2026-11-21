import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';
import { loadedExternalInstances } from './loadedExternalInstances';
import { pendingKeyedUnloadGenerations, pendingKeyedUnloads } from './pendingKeyedUnloads';
import { serializePluginLifecycle } from './serializePluginLifecycle';

function trackPendingKeyedUnload(instanceId: string, unload: Promise<void>): void {
    pendingKeyedUnloads.set(instanceId, unload);
    pendingKeyedUnloadGenerations.set(instanceId, (pendingKeyedUnloadGenerations.get(instanceId) ?? 0) + 1);
    function forget(): void {
        if (pendingKeyedUnloads.get(instanceId) === unload) {
            pendingKeyedUnloads.delete(instanceId);
        }
    }
    void unload.then(forget, forget);
}

/** Run `unloadLoaded` on the instance's lifecycle turn, only while it is still loaded. */
export function scheduleKeyedUnload(instanceId: string, unloadLoaded: () => Promise<void>): Promise<void> {
    externalPluginStateCaptureAuthority.invalidate(instanceId);
    const unload = serializePluginLifecycle(instanceId, () => {
        if (!loadedExternalInstances.has(instanceId)) {
            return Promise.resolve();
        }
        return unloadLoaded();
    });
    trackPendingKeyedUnload(instanceId, unload);
    return unload;
}
