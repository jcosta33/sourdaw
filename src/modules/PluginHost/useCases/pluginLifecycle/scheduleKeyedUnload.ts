import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';
import { loadedExternalInstances } from './loadedExternalInstances';
import { letGoKeyedUnloadGenerations, pendingKeyedUnloadGenerations, pendingKeyedUnloads } from './pendingKeyedUnloads';
import { serializePluginLifecycle } from './serializePluginLifecycle';

function admitKeyedUnload(instanceId: string): number {
    const generation = (pendingKeyedUnloadGenerations.get(instanceId) ?? 0) + 1;
    pendingKeyedUnloadGenerations.set(instanceId, generation);
    return generation;
}

function trackPendingKeyedUnload(instanceId: string, unload: Promise<void>): void {
    pendingKeyedUnloads.set(instanceId, unload);
    function forget(): void {
        if (pendingKeyedUnloads.get(instanceId) === unload) {
            pendingKeyedUnloads.delete(instanceId);
        }
    }
    void unload.then(forget, forget);
}

/**
 * Run `unloadLoaded` on the instance's lifecycle turn, only while it is still
 * loaded and still owns it. `wasLetGo` answers whether a rebuild fence has let
 * go of this unload since; its answer then belongs to no generation still
 * loaded, so `unloadLoaded` writes nothing for the instance once it is true.
 */
export function scheduleKeyedUnload(
    instanceId: string,
    unloadLoaded: (wasLetGo: () => boolean) => Promise<void>
): Promise<void> {
    externalPluginStateCaptureAuthority.invalidate(instanceId);
    const generation = admitKeyedUnload(instanceId);
    function wasLetGo(): boolean {
        return (letGoKeyedUnloadGenerations.get(instanceId) ?? 0) >= generation;
    }
    const unload = serializePluginLifecycle(instanceId, () => {
        if (wasLetGo() || !loadedExternalInstances.has(instanceId)) {
            return Promise.resolve();
        }
        return unloadLoaded(wasLetGo);
    });
    trackPendingKeyedUnload(instanceId, unload);
    return unload;
}
