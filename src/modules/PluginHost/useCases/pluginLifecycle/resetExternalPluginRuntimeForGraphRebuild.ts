import { clearLoadedExternalPlugins } from './clearLoadedExternalPlugins';
import { externalPluginActivationEpoch, externalPluginActivationTasks } from './externalPluginActivationTasks';
import { pluginLifecycleScheduler } from './serializePluginLifecycle';
import { unloadPlugin } from './unloadPlugin';

let activeReset: Promise<void> | null = null;

/** Tears down native external plugins and invalidates the completed graph generation before a rebuild. */
export function resetExternalPluginRuntimeForGraphRebuild(): Promise<void> {
    if (activeReset) {
        return activeReset;
    }

    externalPluginActivationEpoch.current += 1;
    const rebuild = pluginLifecycleScheduler.beginRebuild();
    const admittedActivations = [...externalPluginActivationTasks.values()];
    const reset = (async () => {
        try {
            await Promise.allSettled(admittedActivations);
            await rebuild.waitForExistingOperations();
            await unloadPlugin();
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
