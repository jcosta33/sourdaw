import { clearLoadedExternalPlugins } from './clearLoadedExternalPlugins';
import { commitCarriedLiveStates } from './commitCarriedLiveStates';
import { externalPluginActivationEpoch, externalPluginActivationTasks } from './externalPluginActivationTasks';
import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';
import { failUnresponsiveExternalPlugins } from './failUnresponsiveExternalPlugins';
import { loadedExternalInstances } from './loadedExternalInstances';
import { pendingKeyedUnloadAdmissions } from './pendingKeyedUnloads';
import { readLiveStatesForTeardown } from './readLiveStatesForTeardown';
import { pluginLifecycleScheduler } from './serializePluginLifecycle';
import { unloadEveryPluginKeepingCarries } from './unloadEveryPluginKeepingCarries';

let activeReset: Promise<void> | null = null;

/** Tears down native external plugins and invalidates the completed graph generation before a rebuild. */
export function resetExternalPluginRuntimeForGraphRebuild(): Promise<void> {
    if (activeReset) {
        return activeReset;
    }

    externalPluginStateCaptureAuthority.invalidateAll();
    externalPluginActivationEpoch.current += 1;
    const rebuild = pluginLifecycleScheduler.beginRebuild();
    const admittedActivations = new Map(externalPluginActivationTasks);
    const admittedUnloads = pendingKeyedUnloadAdmissions();
    const reset = (async () => {
        try {
            failUnresponsiveExternalPlugins(
                await rebuild.waitForExistingOperations(admittedActivations),
                admittedUnloads
            );
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
