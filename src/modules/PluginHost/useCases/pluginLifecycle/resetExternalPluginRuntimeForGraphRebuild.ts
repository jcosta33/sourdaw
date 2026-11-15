import { clearLoadedExternalPlugins } from './clearLoadedExternalPlugins';
import { commitCarriedLiveStates } from './commitCarriedLiveStates';
import { externalPluginActivationEpoch, externalPluginActivationTasks } from './externalPluginActivationTasks';
import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';
import { loadedExternalInstances } from './loadedExternalInstances';
import { readLiveStatesForTeardown } from './readLiveStatesForTeardown';
import { pluginLifecycleScheduler } from './serializePluginLifecycle';
import { unloadEveryPluginKeepingCarries } from './unloadPlugin';

let activeReset: Promise<void> | null = null;

/** Tears down native external plugins and invalidates the completed graph generation before a rebuild. */
export function resetExternalPluginRuntimeForGraphRebuild(): Promise<void> {
    if (activeReset) {
        return activeReset;
    }

    externalPluginStateCaptureAuthority.invalidateAll();
    externalPluginActivationEpoch.current += 1;
    const rebuild = pluginLifecycleScheduler.beginRebuild();
    const admittedActivations = [...externalPluginActivationTasks.values()];
    const reset = (async () => {
        try {
            await Promise.allSettled(admittedActivations);
            await rebuild.waitForExistingOperations();
            // The fence holds every lifecycle turn, so the reads run directly.
            const loadedBeforeUnload = [...loadedExternalInstances];
            const reads = await readLiveStatesForTeardown(loadedBeforeUnload, 'inside-lifecycle');
            try {
                await unloadEveryPluginKeepingCarries();
            } finally {
                commitCarriedLiveStates(
                    reads,
                    loadedBeforeUnload.filter((instanceId) => !loadedExternalInstances.has(instanceId))
                );
            }
            clearLoadedExternalPlugins();
        } finally {
            rebuild.end();
        }
    })();
    activeReset = reset;
    void reset
        .finally(() => {
            if (activeReset === reset) {
                activeReset = null;
            }
        })
        .catch(() => undefined);
    return reset;
}
