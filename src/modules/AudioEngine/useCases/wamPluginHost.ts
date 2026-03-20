/**
 * WAM 2.0 Plugin Host Infrastructure.
 * Provides the framework for loading, managing, and routing
 * Web Audio Module 2.0 plugins in the DAW.
 *
 * WAM 2.0 spec: https://github.com/53942/WebAudioModules
 */

export type WAMDescriptor = {
    id: string;
    name: string;
    vendor: string;
    version: string;
    category: 'effect' | 'instrument' | 'midi-effect';
    sdkVersion: string;
    thumbnail?: string;
    keywords?: string[];
};

export type WAMInstance = {
    descriptor: WAMDescriptor;
    audioNode: AudioNode;
    initialized: boolean;
    groupId: string;
};

// In-memory registry
const registry = new Map<string, WAMDescriptor>();
const instances = new Map<string, WAMInstance>();
let groupCounter = 0;

/**
 * Initialize WAM environment for an AudioContext.
 * Must be called before loading any WAM plugins.
 */
export async function initWAMEnvironment(context: AudioContext): Promise<string> {
    const groupId = `wam-group-${++groupCounter}`;

    // WAM SDK initialization:
    // In production, this loads the WAM SDK scripts and initializes
    // the WAM environment on the AudioContext.
    // For now, we store the context reference.
    (context as unknown as Record<string, unknown>).__wamGroupId = groupId;

    return groupId;
}

/**
 * Register a WAM plugin descriptor.
 */
export function registerWAMPlugin(descriptor: WAMDescriptor): void {
    registry.set(descriptor.id, descriptor);
}

/**
 * Get all registered WAM plugins.
 */
export function getRegisteredPlugins(): WAMDescriptor[] {
    return [...registry.values()];
}

/**
 * Get plugins by category.
 */
export function getPluginsByCategory(category: WAMDescriptor['category']): WAMDescriptor[] {
    return [...registry.values()].filter((d) => d.category === category);
}

/**
 * Load and instantiate a WAM plugin.
 */
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

    // Create a passthrough node as placeholder for real WAM instantiation
    const node = context.createGain();
    node.gain.value = 1.0;

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

/**
 * Unload a WAM plugin instance.
 */
export function unloadWAMPlugin(instanceId: string): void {
    const instance = instances.get(instanceId);
    if (instance) {
        if ('disconnect' in instance.audioNode) {
            instance.audioNode.disconnect();
        }
        instances.delete(instanceId);
    }
}

/**
 * Get all active WAM instances.
 */
export function getActiveInstances(): Map<string, WAMInstance> {
    return new Map(instances);
}

// ─── Register built-in WAM-compatible plugins ─────────────
// These are the factory plugins that ship with the DAW

const BUILTIN_WAM_DESCRIPTORS: WAMDescriptor[] = [
    {
        id: 'webdaw.eq',
        name: 'Parametric EQ',
        vendor: 'WebDAW',
        version: '1.0',
        category: 'effect',
        sdkVersion: '2.0',
        keywords: ['eq', 'filter', 'tone'],
    },
    {
        id: 'webdaw.compressor',
        name: 'Compressor',
        vendor: 'WebDAW',
        version: '1.0',
        category: 'effect',
        sdkVersion: '2.0',
        keywords: ['dynamics', 'compressor'],
    },
    {
        id: 'webdaw.reverb',
        name: 'Reverb',
        vendor: 'WebDAW',
        version: '1.0',
        category: 'effect',
        sdkVersion: '2.0',
        keywords: ['reverb', 'space'],
    },
    {
        id: 'webdaw.delay',
        name: 'Delay',
        vendor: 'WebDAW',
        version: '1.0',
        category: 'effect',
        sdkVersion: '2.0',
        keywords: ['delay', 'echo'],
    },
    {
        id: 'webdaw.chorus',
        name: 'Chorus',
        vendor: 'WebDAW',
        version: '1.0',
        category: 'effect',
        sdkVersion: '2.0',
        keywords: ['modulation', 'chorus'],
    },
    {
        id: 'webdaw.distortion',
        name: 'Distortion',
        vendor: 'WebDAW',
        version: '1.0',
        category: 'effect',
        sdkVersion: '2.0',
        keywords: ['distortion', 'saturation'],
    },
    {
        id: 'webdaw.limiter',
        name: 'Limiter',
        vendor: 'WebDAW',
        version: '1.0',
        category: 'effect',
        sdkVersion: '2.0',
        keywords: ['dynamics', 'limiter'],
    },
    {
        id: 'webdaw.synth',
        name: 'Subtractive Synth',
        vendor: 'WebDAW',
        version: '1.0',
        category: 'instrument',
        sdkVersion: '2.0',
        keywords: ['synth', 'subtractive'],
    },
    {
        id: 'webdaw.drumkit',
        name: 'Drum Machine',
        vendor: 'WebDAW',
        version: '1.0',
        category: 'instrument',
        sdkVersion: '2.0',
        keywords: ['drums', 'percussion'],
    },
    {
        id: 'webdaw.sampler',
        name: 'Sampler',
        vendor: 'WebDAW',
        version: '1.0',
        category: 'instrument',
        sdkVersion: '2.0',
        keywords: ['sampler', 'sample'],
    },
];

/**
 * Register all built-in WAM plugins.
 * Call this during app initialization.
 */
export function registerBuiltinPlugins(): void {
    for (const desc of BUILTIN_WAM_DESCRIPTORS) {
        registerWAMPlugin(desc);
    }
}
