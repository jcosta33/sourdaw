import { type WAMDescriptor, type WAMInstance } from '#/modules/Plugin/models/WamPluginHostTypes';

// In-memory registries (raw Map singletons — not Store<T>)
const registry = new Map<string, WAMDescriptor>();
const instances = new Map<string, WAMInstance>();
let groupCounter = 0;

export async function initWAMEnvironment(context: AudioContext): Promise<string> {
    const groupId = `wam-group-${++groupCounter}`;
    (context as unknown as Record<string, unknown>).__wamGroupId = groupId;
    return groupId;
}

export function registerWAMPlugin(descriptor: WAMDescriptor): void {
    registry.set(descriptor.id, descriptor);
}

export function getRegisteredPlugins(): WAMDescriptor[] {
    return [...registry.values()];
}

export function getPluginsByCategory(category: WAMDescriptor['category']): WAMDescriptor[] {
    return [...registry.values()].filter((d) => d.category === category);
}

export async function loadWAMPlugin(
    pluginId: string,
    context: AudioContext,
    groupId: string
): Promise<WAMInstance | null> {
    const descriptor = registry.get(pluginId);
    if (!descriptor) {
        console.warn(`WAM plugin ${pluginId} not found in registry`);
        return null;
    }

    let node: AudioNode;

    if (pluginId.startsWith('faust.')) {
        const faustModuleId = pluginId.replace('faust.', '');
        const { compileFaustDSP, createFaustNode } = await import('../faustEngine');
        const compiled = await compileFaustDSP(faustModuleId);
        if (compiled) {
            const faustNode = await createFaustNode(faustModuleId, context);
            if (faustNode) {
                node = faustNode as unknown as AudioNode;
            } else {
                console.warn(`[WAM] Faust node creation failed for ${pluginId}, using passthrough`);
                node = context.createGain();
            }
        } else {
            console.warn(`[WAM] Faust compilation failed for ${pluginId}, using passthrough`);
            node = context.createGain();
        }
    } else if (descriptor.isHighEnd) {
        try {
            node = new AudioWorkletNode(context, 'HighEndPluginProcessor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
            });
        } catch (e) {
            console.warn(`[WAM] HighEndPluginProcessor not registered for ${pluginId}`, e);
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

export function unloadWAMPlugin(instanceId: string): void {
    const instance = instances.get(instanceId);
    if (instance) {
        if ('disconnect' in instance.audioNode) {
            instance.audioNode.disconnect();
        }
        instances.delete(instanceId);
    }
}

export function getActiveInstances(): Map<string, WAMInstance> {
    return new Map(instances);
}
