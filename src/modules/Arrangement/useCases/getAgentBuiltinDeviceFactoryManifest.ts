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
    modulatable: boolean;
    semanticRole: 'unspecified';
    perceptualRole: 'unspecified';
    typicalRange: { minimum: number; maximum: number; confidence: 'declared' };
    interactions: readonly string[];
    risks: readonly string[];
    gainCompensation: 'unknown';
};

type AgentBuiltinDevice = {
    type: string;
    version: 'builtin-v1';
    vendor: string;
    name: string;
    category: PluginDescriptor['category'];
    capabilities: readonly string[];
    ports: {
        inputs: readonly [{ id: 'main-in'; channels: 2 }];
        outputs: readonly [{ id: 'main-out'; channels: 2 }];
        sidechain: readonly [];
    };
    latency: { samples: 0; confidence: 'declared' };
    tail: PluginDescriptor['tail'] | null;
    presets: readonly [];
    safetyNotes: readonly string[];
    usageRecipes: readonly string[];
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
    return {
        id: parameter.id,
        name: parameter.name,
        type: parameterType(parameter),
        unit: parameter.unit,
        bounds: { minimum: parameter.minValue, maximum: parameter.maxValue },
        default: parameter.defaultValue,
        enumValues: parameter.choices ?? null,
        automatable: parameter.automatable,
        modulatable: false,
        semanticRole: 'unspecified',
        perceptualRole: 'unspecified',
        typicalRange: { minimum: parameter.minValue, maximum: parameter.maxValue, confidence: 'declared' },
        interactions: [],
        risks: [],
        gainCompensation: 'unknown',
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
        capabilities: descriptor.platform === 'native' ? ['native-runtime'] : ['audio-processing'],
        ports: { inputs: [{ id: 'main-in', channels: 2 }], outputs: [{ id: 'main-out', channels: 2 }], sidechain: [] },
        latency: { samples: 0, confidence: 'declared' },
        tail: descriptor.tail ?? null,
        presets: [],
        safetyNotes: [],
        usageRecipes: [],
        parameters: descriptor.parameters.map(toManifestParameter),
        metadata: { source: 'Arrangement descriptor', confidence: 'declared' },
    }));
}
