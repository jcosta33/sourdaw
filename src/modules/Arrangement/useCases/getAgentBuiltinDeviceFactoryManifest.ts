import {
    BUILTIN_PLUGINS,
    isDeviceSupportedOnCurrentPlatform,
    type DeviceParameter,
    type PluginDescriptor,
} from '../models/DeviceParameter';

import { getDeviceContractVersionForCommand } from './getDeviceContractVersionForCommand';

type AgentDeviceParameter = {
    id: string;
    name: string;
    type: 'continuous' | 'integer' | 'boolean' | 'enum';
    unit: string;
    bounds: { minimum: number; maximum: number };
    default: number;
    enumValues: readonly string[] | null;
    automatable: boolean;
};

type AgentBuiltinDeviceDescriptor = {
    type: string;
    descriptorVersion: string;
    vendor: string;
    name: string;
    category: PluginDescriptor['category'];
    platform: NonNullable<PluginDescriptor['platform']>;
    availability: 'available' | 'unavailable-on-platform';
    tail: PluginDescriptor['tail'] | null;
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
    };
}

/** Arrangement owns catalog descriptors, never live node topology or latency. */
export function getAgentBuiltinDeviceFactoryManifest(): readonly AgentBuiltinDeviceDescriptor[] {
    return BUILTIN_PLUGINS.map((descriptor) => {
        const descriptorVersion = getDeviceContractVersionForCommand(descriptor.id);
        if (!descriptorVersion) {
            throw new Error(`Built-in descriptor fingerprint unavailable: ${descriptor.id}`);
        }
        return {
            type: descriptor.id,
            descriptorVersion,
            vendor: descriptor.vendor,
            name: descriptor.name,
            category: descriptor.category,
            platform: descriptor.platform ?? 'both',
            availability: isDeviceSupportedOnCurrentPlatform(descriptor.id) ? 'available' : 'unavailable-on-platform',
            tail: descriptor.tail ?? null,
            parameters: descriptor.parameters.map(toManifestParameter),
            metadata: { source: 'Arrangement descriptor', confidence: 'declared' },
        };
    });
}
