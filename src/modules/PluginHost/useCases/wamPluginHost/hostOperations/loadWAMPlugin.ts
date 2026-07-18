import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type WAMInstance } from '../../../models/WamPluginHostTypes';
import { findPluginLoader } from '../../../services/pluginLoaderRegistry';

import { instances, registry } from './helpers';

export async function loadWAMPlugin(
    pluginId: string,
    context: AudioContext,
    groupId: string
): Promise<WAMInstance | null> {
    const descriptor = registry.get(pluginId);
    if (!descriptor) {
        logger.warn(`WAM plugin ${pluginId} not found in registry`);
        return null;
    }

    let node: AudioNode;

    const customLoader = findPluginLoader(pluginId);
    if (customLoader) {
        const customNode = await customLoader(pluginId, context);
        if (!customNode) {
            // §61.2 — previously fell back to a no-op GainNode and returned
            // `initialized: true`, so the caller thought the plugin was
            // alive while it silently passed audio through unprocessed.
            // Surface the failure both to logs and to the user and return
            // null so the caller can treat it as a load error.
            logger.warn(`[WAM] Custom loader returned null for ${pluginId}`);
            notifyUser(
                `Plugin "${descriptor.name}" failed to load — its custom loader returned no audio node.`,
                'error'
            );
            return null;
        }
        node = customNode;
    } else if (descriptor.isHighEnd) {
        try {
            node = new AudioWorkletNode(context, 'HighEndPluginProcessor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
            });
        } catch (error) {
            // §61.2 — HighEndPluginProcessor worklet not registered. Return
            // null (not a silent passthrough) so callers can fall back or
            // alert the user rather than silently routing unprocessed audio.
            logger.warn(`[WAM] HighEndPluginProcessor not registered for ${pluginId}`, error);
            notifyUser(
                `Plugin "${descriptor.name}" failed to load — the HighEnd audio worklet isn't registered in this context.`,
                'error'
            );
            return null;
        }
    } else {
        // Vanilla pass-through plugins intentionally use a GainNode — this
        // is the expected "untouched audio" path, not a silent failure.
        node = context.createGain();
    }

    const instanceId = `${pluginId}-${crypto.randomUUID().slice(0, 8)}`;
    const instance: WAMInstance = {
        instanceId,
        descriptor,
        audioNode: node,
        initialized: true,
        groupId,
    };

    instances.set(instanceId, instance);
    return instance;
}
