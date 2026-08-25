import { clearLoadedExternalPlugins } from './clearLoadedExternalPlugins';
import { externalPluginActivationTasks } from './externalPluginActivationTasks';
import { unloadPlugin } from './unloadPlugin';

/** Tears down native external plugins and invalidates the completed graph generation before a rebuild. */
export async function resetExternalPluginRuntimeForGraphRebuild(): Promise<void> {
    await Promise.allSettled([...externalPluginActivationTasks.values()]);
    await unloadPlugin();
    clearLoadedExternalPlugins();
}
