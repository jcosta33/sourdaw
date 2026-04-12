import { type WAMInstance } from '../../../models/WamPluginHostTypes';
import { findPluginLoader } from '../../../services/pluginLoaderRegistry';
import { instances, registry } from './helpers';
import { logger } from '#/infra/logger/appLogger';

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
        if (customNode) {
            node = customNode;
        } else {
            logger.warn(`[WAM] Custom loader returned null for ${pluginId}, using passthrough`);
            node = context.createGain();
        }
    } else if (descriptor.isHighEnd) {
        try {
            node = new AudioWorkletNode(context, 'HighEndPluginProcessor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
            });
        } catch (e) {
            logger.warn(`[WAM] HighEndPluginProcessor not registered for ${pluginId}`, e);
            node = context.createGain();
        }
    } else {
        node = context.createGain();
    }

    const instance: WAMInstance = {
        descriptor,
        audioNode: node,
        initialized: true,
        groupId,
    };

    const instanceId = `${pluginId}-${crypto.randomUUID().slice(0, 8)}`;
    instances.set(instanceId, instance);
    return instance;
}