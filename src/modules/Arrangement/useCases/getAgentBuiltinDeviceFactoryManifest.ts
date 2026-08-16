import {
    BUILTIN_PLUGINS,
    isDeviceSupportedOnCurrentPlatform,
    type DeviceParameter,
    type DeviceParameterGuidance,
    type PluginDescriptor,
} from '../models/DeviceParameter';
import { getFactoryPresetContractsByDeviceType } from '../repositories/presets/getFactoryPresetContractsByDeviceType';

import { getDeviceContractVersionForCommand } from './getDeviceContractVersionForCommand';
import { getFactoryPresets } from './soundPresetLibrary';

type AgentDeviceParameter = {
    id: string;
    name: string;
    type: 'continuous' | 'integer' | 'boolean' | 'enum';
    unit: string;
    bounds: { minimum: number; maximum: number };
    default: number;
    enumValues: readonly string[] | null;
    automatable: boolean;
    guidance: DeviceParameterGuidance;
};

type AgentBuiltinDeviceDescriptor = {
    type: string;
    descriptorVersion: string;
    presetVersion: string;
    capabilities: NonNullable<PluginDescriptor['capabilities']>;
    guidance: Omit<NonNullable<PluginDescriptor['guidance']>, 'parameters'>;
    vendor: string;
    name: string;
    category: PluginDescriptor['category'];
    platform: NonNullable<PluginDescriptor['platform']>;
    availability: 'available' | 'unavailable-on-platform';
    tail: PluginDescriptor['tail'] | null;
    presets: {
        availability: 'available' | 'none';
        identities: readonly { id: string; name: string }[];
    };
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

function toManifestParameter(parameter: DeviceParameter, guidance: DeviceParameterGuidance): AgentDeviceParameter {
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
        guidance,
    };
}

/** Arrangement owns catalog descriptors, never live node topology or latency. */
export function getAgentBuiltinDeviceFactoryManifest(): readonly AgentBuiltinDeviceDescriptor[] {
    const presetContracts = new Map(
        getFactoryPresetContractsByDeviceType(
            getFactoryPresets(),
            BUILTIN_PLUGINS.map((descriptor) => descriptor.id)
        ).map((contract) => [contract.type, contract])
    );

    return BUILTIN_PLUGINS.map((descriptor) => {
        const descriptorVersion = getDeviceContractVersionForCommand(descriptor.id);
        if (!descriptorVersion) {
            throw new Error(`Built-in descriptor fingerprint unavailable: ${descriptor.id}`);
        }
        const presetContract = presetContracts.get(descriptor.id);
        if (!presetContract) {
            throw new Error(`Built-in preset contract unavailable: ${descriptor.id}`);
        }
        if (!descriptor.guidance) {
            throw new Error(`Built-in operating guidance unavailable: ${descriptor.id}`);
        }
        if (!descriptor.capabilities) {
            throw new Error(`Built-in capability declaration unavailable: ${descriptor.id}`);
        }
        return {
            type: descriptor.id,
            descriptorVersion,
            presetVersion: presetContract.presetVersion,
            capabilities: descriptor.capabilities,
            guidance: {
                usage: descriptor.guidance.usage,
                safety: descriptor.guidance.safety,
                interactions: descriptor.guidance.interactions,
                risks: descriptor.guidance.risks,
                gainCompensation: descriptor.guidance.gainCompensation,
            },
            vendor: descriptor.vendor,
            name: descriptor.name,
            category: descriptor.category,
            platform: descriptor.platform ?? 'both',
            availability: isDeviceSupportedOnCurrentPlatform(descriptor.id) ? 'available' : 'unavailable-on-platform',
            tail: descriptor.tail ?? null,
            presets: {
                availability: presetContract.availability,
                identities: presetContract.identities,
            },
            parameters: descriptor.parameters.map((parameter) => {
                const guidance = descriptor.guidance?.parameters[parameter.id];
                if (!guidance) {
                    throw new Error(`Built-in parameter guidance unavailable: ${descriptor.id}/${parameter.id}`);
                }
                return toManifestParameter(parameter, guidance);
            }),
            metadata: { source: 'Arrangement descriptor', confidence: 'declared' },
        };
    });
}
