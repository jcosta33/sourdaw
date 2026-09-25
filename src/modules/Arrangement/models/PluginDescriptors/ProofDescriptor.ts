/**
 * Proof — mastering suite plugin descriptor.
 * Registers Proof as an effect with custom UI that opens a bottom panel.
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, effectGuidance } from './GuidanceProfiles';

const PROOF_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'proof',
    name: 'Proof',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: [
        {
            id: 'input_gain',
            deviceId: 'proof',
            name: 'Input Gain',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: -24,
            maxValue: 24,
            unit: 'dB',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'output_gain',
            deviceId: 'proof',
            name: 'Output Gain',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: -24,
            maxValue: 24,
            unit: 'dB',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'lim_ceiling',
            deviceId: 'proof',
            name: 'Ceiling',
            type: 'float',
            value: -1,
            defaultValue: -1,
            minValue: -12,
            maxValue: 0,
            unit: 'dB',
            automatable: true,
            hasAutomation: false,
        },
    ],
};

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const PROOF_DESCRIPTOR = applySingleDescriptorGuidance(
    PROOF_DESCRIPTOR_DATA,
    descriptorGuidance(
        'proof',
        effectGuidance(
            'Use mastering controls for restrained final-stage tonal and level decisions.',
            ['Leave delivery headroom and compare changes at matched loudness.'],
            ['Mastering tone, dynamics, and ceiling controls interact across the whole mix.'],
            ['Aggressive mastering can hide balance problems and reduce transient detail.'],
            { availability: 'unavailable', reason: 'Proof declares no automatic loudness matching.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            input_gain: parameterGuidance(
                'Chain input trim',
                'Scales the signal before every mastering module runs, including the limiter.',
                -6,
                6,
                [
                    "Runs before lim_ceiling's limiter and before output_gain, so raising this changes how hard the limiter works without moving the final output level the way output_gain does.",
                ],
                [
                    'Driving this up feeds the limiter harder without changing the final ceiling, so it can increase audible gain reduction even though lim_ceiling stays the same.',
                ],
                noExternalModulation
            ),
            output_gain: parameterGuidance(
                'Chain output trim',
                'Scales the signal after every mastering module, including the limiter and dither, before it leaves the chain.',
                -6,
                0,
                [
                    "Applied after lim_ceiling's limiter and its dither stage, so raising this can push the signal back over the ceiling that lim_ceiling just enforced; input_gain instead changes what reaches the limiter.",
                ],
                [
                    'Because this is applied after the limiter and dither, raising it can push output level back above lim_ceiling even though the limiter measured compliance before this stage ran.',
                ],
                noExternalModulation
            ),
            lim_ceiling: parameterGuidance(
                'Limiter output ceiling',
                "Sets the hard maximum true-peak level the chain's limiter will not exceed before output_gain is applied.",
                -3,
                -0.3,
                [
                    'input_gain sets how hard the limiter works to reach this ceiling, and output_gain applied afterward can push the final level back past it.',
                ],
                [
                    'A ceiling near 0 dB leaves little margin before output_gain, applied after the limiter, can push the final level above it.',
                ],
                noExternalModulation
            ),
        }
    )
);
