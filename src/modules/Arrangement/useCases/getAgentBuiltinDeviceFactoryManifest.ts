import { BUILTIN_PLUGINS, type DeviceParameter, type PluginDescriptor } from '../models/DeviceParameter';

type AgentDeviceParameter = {
    id: string;
    name: string;
    type: 'continuous' | 'integer' | 'boolean' | 'enum';
    unit: string;
    bounds: { minimum: number; maximum: number };
    default: number;
    enumValues: readonly string[] | null;
    automatable: boolean;
    modulatable: { availability: 'unavailable'; source: 'Arrangement descriptor' };
    semanticRole: { value: string; confidence: 'inferred'; source: 'parameter type' };
    perceptualRole: { value: 'audible-parameter'; confidence: 'inferred'; source: 'device descriptor' };
    typicalRange: { minimum: number; maximum: number; confidence: 'declared' };
    interactions: readonly [string];
    risks: readonly [string];
    gainCompensation: { availability: 'unavailable'; source: 'Arrangement descriptor' };
};

type AgentBuiltinDevice = {
    type: string;
    version: 'builtin-v1';
    vendor: string;
    name: string;
    category: PluginDescriptor['category'];
    capabilities: readonly [string];
    ports: {
        inputs: readonly { id: string; channels: number }[];
        outputs: readonly { id: string; channels: number }[];
        sidechain: readonly { id: string; channels: number }[];
        source: 'Arrangement descriptor strategy';
        confidence: 'inferred';
    };
    latency: { samples: number | null; source: 'Arrangement descriptor strategy'; confidence: 'inferred' };
    tail: PluginDescriptor['tail'] | null;
    presets: { availability: 'none'; source: 'Arrangement descriptor strategy' };
    safetyNotes: readonly [string];
    usageRecipes: readonly [string];
    parameters: readonly AgentDeviceParameter[];
    metadata: { source: 'Arrangement descriptor'; confidence: 'declared' };
};

function parameterType(parameter: DeviceParameter): AgentDeviceParameter['type'] {
    switch (parameter.type) {
        case 'float':
            return 'continuous';
        case 'int':
            return 'integer';
        case 'bool':
            return 'boolean';
        case 'choice':
            return 'enum';
    }
    throw new Error(`Unsupported device parameter type: ${parameter.type}`);
}

function toManifestParameter(parameter: DeviceParameter): AgentDeviceParameter {
    const type = parameterType(parameter);
    return {
        id: parameter.id,
        name: parameter.name,
        type,
        unit: parameter.unit,
        bounds: { minimum: parameter.minValue, maximum: parameter.maxValue },
        default: parameter.defaultValue,
        enumValues: parameter.choices ?? null,
        automatable: parameter.automatable,
        modulatable: { availability: 'unavailable', source: 'Arrangement descriptor' },
        semanticRole: { value: `${type}-control`, confidence: 'inferred', source: 'parameter type' },
        perceptualRole: { value: 'audible-parameter', confidence: 'inferred', source: 'device descriptor' },
        typicalRange: { minimum: parameter.minValue, maximum: parameter.maxValue, confidence: 'declared' },
        interactions: ['Writes are bounded by the descriptor minimum and maximum.'],
        risks: ['Automation changes the audible device output.'],
        gainCompensation: { availability: 'unavailable', source: 'Arrangement descriptor' },
    };
}

/** Application-readable projection of Arrangement-owned built-in factory truth. */
export function getAgentBuiltinDeviceFactoryManifest(): readonly AgentBuiltinDevice[] {
    return BUILTIN_PLUGINS.map((descriptor) => ({
        type: descriptor.id,
        version: 'builtin-v1',
        vendor: descriptor.vendor,
        name: descriptor.name,
        category: descriptor.category,
        capabilities: [descriptor.category === 'instrument' ? 'instrument-generation' : 'audio-processing'],
        ports: {
            inputs: descriptor.category === 'instrument' ? [] : [{ id: 'main-in', channels: 2 }],
            outputs: [{ id: 'main-out', channels: 2 }],
            sidechain: descriptor.id === 'builtin-compressor' ? [{ id: 'sidechain-in', channels: 2 }] : [],
            source: 'Arrangement descriptor strategy',
            confidence: 'inferred',
        },
        latency: { samples: 0, source: 'Arrangement descriptor strategy', confidence: 'inferred' },
        tail: descriptor.tail ?? null,
        presets: { availability: 'none', source: 'Arrangement descriptor strategy' },
        safetyNotes: ['Apply only declared parameter bounds through the owning device write path.'],
        usageRecipes: [
            descriptor.category === 'instrument'
                ? 'Use on a MIDI-capable track through an application-approved insertion.'
                : 'Use through an application-approved device insertion.',
        ],
        parameters: descriptor.parameters.map(toManifestParameter),
        metadata: { source: 'Arrangement descriptor', confidence: 'declared' },
    }));
}
