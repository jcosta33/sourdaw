import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../stores/externalPluginActivationStore';

import { loadedExternalInstancePluginIds } from './loadedExternalInstances';
import { pluginUnresponsiveMessage } from './pluginUnresponsiveMessage';

/**
 * Fail the slots whose lifecycle calls a rebuild fence stopped waiting for.
 *
 * Such a call is inside the plugin and may never return; the fence goes on
 * without it, and the native host refuses every later call on that instance
 * once its control gate outlives its own deadline. Each slot shows the
 * unresponsive message, and the user is told by plugin name.
 */
export function failUnresponsiveExternalPlugins(instanceIds: ReadonlySet<string>): void {
    for (const instanceId of instanceIds) {
        const pluginId = loadedExternalInstancePluginIds.get(instanceId) ?? instanceId;
        const message = pluginUnresponsiveMessage(pluginId);
        externalPluginActivationStore.update((state) => {
            const current = state ?? defaultExternalPluginActivationState;
            return {
                ...current,
                byInstanceId: { ...current.byInstanceId, [instanceId]: { status: 'error', message } },
            };
        });
        logger.warn(`External plugin ${pluginId} instance ${instanceId}: ${message}`);
        notifyUser(message, 'error');
    }
}
