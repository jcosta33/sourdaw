import { clearLoadedExternalPlugins } from './clearLoadedExternalPlugins';
import { externalPluginActivationEpoch, externalPluginActivationTasks } from './externalPluginActivationTasks';
import { pluginLifecycleScheduler } from './serializePluginLifecycle';
import { unloadPlugin } from './unloadPlugin';

/** Fences plugin admission across a renderer project-session retirement. */
export function beginProjectSessionPluginRetirement(): {
    readonly retire: () => Promise<void>;
    readonly reopen: () => void;
} {
    externalPluginActivationEpoch.current += 1;
    const rebuild = pluginLifecycleScheduler.beginRebuild();
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
