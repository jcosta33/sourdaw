import { clearLoadedExternalPlugins } from './clearLoadedExternalPlugins';
import { externalPluginActivationEpoch, externalPluginActivationTasks } from './externalPluginActivationTasks';
import { pluginLifecycleScheduler } from './serializePluginLifecycle';
import { unloadPlugin } from './unloadPlugin';

/** Fences plugin admission across a renderer project-session retirement. */
export async function beginProjectSessionPluginRetirement(): Promise<{
    readonly retire: () => Promise<void>;
    readonly reopen: () => void;
}> {
    const rebuild = await pluginLifecycleScheduler.beginRebuildAfterCurrent();
    externalPluginActivationEpoch.current += 1;
    const admittedActivations = [...externalPluginActivationTasks.values()];
    let reopened = false;
    return {
        retire: async (): Promise<void> => {
            await Promise.allSettled(admittedActivations);
            await rebuild.waitForExistingOperations();
            await unloadPlugin();
            clearLoadedExternalPlugins();
        },
        reopen: (): void => {
            if (reopened) {
                return;
            }
            reopened = true;
            rebuild.end();
        },
    };
}
