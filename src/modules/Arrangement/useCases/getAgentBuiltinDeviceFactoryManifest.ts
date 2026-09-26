import { isDeviceReleaseAdmitted } from '#/infra/release/deviceReleaseAdmission';

import {
    BUILTIN_PLUGINS,
    isDeviceSupportedOnCurrentPlatform,
    type DeviceParameter,
    type DeviceParameterGuidance,
    type PluginDescriptor,
} from '../models/DeviceParameter';
import { getStableContractFingerprint } from '../models/GetStableContractFingerprint';
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
    /** See {@link DeviceParameter.legalSet}. Omitted when the descriptor declares no legal set. */
    legalValues?: readonly number[];
    automatable: boolean;
    guidance: DeviceParameterGuidance;
};

type AgentBuiltinDeviceDescriptor = {
    type: string;
    descriptorVersion: string;
    characterVersion: string;
    presetVersion: string;
    characterTags: readonly NonNullable<PluginDescriptor['characterTags']>[number][];
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
    const manifestParameter: AgentDeviceParameter = {
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
    if (parameter.legalSet) {
        return { ...manifestParameter, legalValues: [...parameter.legalSet.values] };
    }
    return manifestParameter;
}

/**
 * Arrangement owns catalog descriptors, never live node topology or latency.
 *
 * `types` narrows the released catalog before the per-descriptor fingerprint and preset work
 * below, rather than after: every field this builds for one descriptor depends only on that
 * descriptor and the shared preset library, never on which other descriptors are also being
 * built, so narrowing first returns byte-identical entries at a fraction of the cost. A caller
 * paging one type's parameters would otherwise pay for every other type's descriptor on each call.
 */
export function getAgentBuiltinDeviceFactoryManifest(
    types?: readonly string[]
): readonly AgentBuiltinDeviceDescriptor[] {
    const releasedDescriptors = BUILTIN_PLUGINS.filter(
        (descriptor) => isDeviceReleaseAdmitted(descriptor.id) && (types === undefined || types.includes(descriptor.id))
    );
    const presetContracts = new Map(
        getFactoryPresetContractsByDeviceType(
            getFactoryPresets(),
            releasedDescriptors.map((descriptor) => descriptor.id)
        ).map((contract) => [contract.type, contract])
    );

    return releasedDescriptors.map((descriptor) => {
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
            characterVersion: `character-v1:${getStableContractFingerprint({
                type: descriptor.id,
                characterTags: descriptor.characterTags ?? [],
            })}`,
            presetVersion: presetContract.presetVersion,
            characterTags: descriptor.characterTags ?? [],
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
