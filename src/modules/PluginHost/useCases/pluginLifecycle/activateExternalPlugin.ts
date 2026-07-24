import { logger } from '#/infra/logger/appLogger';

import { loadedExternalInstances } from './loadedExternalInstances';
import { loadPlugin } from './loadPlugin';
import { restorePluginState } from './restorePluginState';

type ActivateExternalPluginInput = {
    pluginId: string;
    instanceId: string;
    stateChunk?: string;
};

/**
 * Instantiate a native plugin in the live audio graph and restore its persisted
 * state chunk — exactly once per graph generation. This is the single activation
 * entry point for both interactive adds and the project-open rebuild.
 *
 * Idempotent: a call for an instance already live returns immediately, so the
 * post-open rebuild and every Play/record (all route through `ensureTrackStrips`)
 * do not re-issue load/restore IPC for a plugin that is already loaded.
 *
 * The restore is queued immediately after instantiation on the same lifecycle
 * tail — it is NOT synchronized with the first audio block. A running native
 * engine can process a few default-state blocks before the restore IPC lands
 * (`add_plugin_with_bridge` enqueues to the RT ring before the restore command
 * returns); state converges to the saved chunk shortly after.
 */
export function activateExternalPlugin({ pluginId, instanceId, stateChunk }: ActivateExternalPluginInput): void {
    if (loadedExternalInstances.has(instanceId)) {
        return;
    }
    loadedExternalInstances.add(instanceId);

    void (async () => {
        try {
            await loadPlugin(pluginId, instanceId);
        } catch (error) {
            // Instantiation failed: drop the guard so a later rebuild can retry.
            loadedExternalInstances.delete(instanceId);
            logger.warn(`Failed to load external plugin ${pluginId} for instance ${instanceId}: ${String(error)}`);
            return;
        }

        if (!stateChunk) {
            return;
        }
        try {
            await restorePluginState(instanceId, stateChunk);
        } catch (error) {
            // Restore failure must not reload: the instance is loaded, so keep the
            // guard and only log — a later rebuild should not re-instantiate it.
            logger.warn(
                `Failed to restore state for external plugin ${pluginId} instance ${instanceId}: ${String(error)}`
            );
        }
    })();
}
