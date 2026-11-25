import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { onPluginServiceChanged } from '../../repositories/pluginBridge/onPluginServiceChanged';
import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
    type ExternalPluginActivationStatus,
} from '../../stores/externalPluginActivationStore';

import { externalPluginServiceMessages } from './externalPluginServiceMessages';
import { loadedExternalInstancePluginIds, loadedExternalInstances } from './loadedExternalInstances';
import { pluginOutOfServiceMessage } from './pluginOutOfServiceMessage';

/**
 * The single live subscription, or `null` when none is running. Held as the
 * in-flight promise so concurrent activations cannot start a second listener
 * while the first is still resolving.
 */
let subscription: Promise<() => void> | null = null;

function setSlot(instanceId: string, entry: ExternalPluginActivationStatus): void {
    externalPluginActivationStore.update((state) => {
        const current = state ?? defaultExternalPluginActivationState;
        return { ...current, byInstanceId: { ...current.byInstanceId, [instanceId]: entry } };
    });
}

function takeOutOfService(instanceId: string, reason: string): void {
    const pluginId = loadedExternalInstancePluginIds.get(instanceId) ?? instanceId;
    const message = pluginOutOfServiceMessage(pluginId, reason);
    // 'active' with a message is the slot's degraded rendering: the editor stays
    // openable, so the musician can undo whatever caused it. 'error' would hide it.
    externalPluginServiceMessages.set(instanceId, message);
    setSlot(instanceId, { status: 'active', message });
    logger.warn(`External plugin ${pluginId} instance ${instanceId}: ${message}`);
    notifyUser(message, 'warning');
}

function putBackInService(instanceId: string): void {
    const message = externalPluginServiceMessages.get(instanceId);
    externalPluginServiceMessages.delete(instanceId);
    if (message === undefined) {
        return;
    }
    const entry = externalPluginActivationStore.value?.byInstanceId[instanceId];
    if (entry?.status !== 'active' || entry.message !== message) {
        return;
    }
    setSlot(instanceId, { status: 'active' });
}

/**
 * Ensure the `plugin-service-changed` subscription is live, showing an instance
 * the host took out of service on its device slot and clearing it when the host
 * puts the instance back.
 *
 * Idempotent: the first activation starts it and every later one reuses it. If
 * subscribing fails the slot is released so a later activation retries rather
 * than leaving service changes permanently unheard.
 */
export function watchExternalPluginService(): void {
    if (subscription) {
        return;
    }

    subscription = onPluginServiceChanged(({ instance_id: instanceId, out_of_service_reason: reason }) => {
        if (!loadedExternalInstances.has(instanceId)) {
            return;
        }
        if (reason === null) {
            putBackInService(instanceId);
            return;
        }
        takeOutOfService(instanceId, reason);
    }).catch((error: unknown) => {
        subscription = null;
        logger.warn(`Failed to subscribe to native plugin service changes: ${String(error)}`);
        return () => {};
    });
}
