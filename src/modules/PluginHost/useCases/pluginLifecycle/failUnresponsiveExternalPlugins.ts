import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../stores/externalPluginActivationStore';

import { loadedExternalInstancePluginIds } from './loadedExternalInstances';
import { pendingKeyedUnloads } from './pendingKeyedUnloads';
import { pluginUnresponsiveMessage } from './pluginUnresponsiveMessage';

/**
 * Fail the slots whose lifecycle calls a rebuild fence stopped waiting for.
 *
 * Such a call is inside the plugin and may never return; the fence goes on
 * without it, and the native host refuses every later call on that instance
 * once its control gate outlives its own deadline. Each slot shows the
 * unresponsive message, and the user is told by plugin name. A keyed unload
 * among those calls is let go with them, so a reactivation loads afresh rather
 * than waiting on an unload that may never settle. Only an unload admitted
 * before the fence (`admittedUnloads`, read when the fence began) is let go: one
 * scheduled while the fence stood has not reached the plugin yet and still owns
 * the instance, so a reactivation must keep waiting for it.
 */
export function failUnresponsiveExternalPlugins(
    instanceIds: ReadonlySet<string>,
    admittedUnloads: ReadonlyMap<string, Promise<void>>
): void {
    for (const instanceId of instanceIds) {
        letGoOfAdmittedUnload(instanceId, admittedUnloads.get(instanceId));
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

function letGoOfAdmittedUnload(instanceId: string, admitted: Promise<void> | undefined): void {
    if (admitted !== undefined && pendingKeyedUnloads.get(instanceId) === admitted) {
        pendingKeyedUnloads.delete(instanceId);
    }
}
