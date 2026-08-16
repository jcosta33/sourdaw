/**
 * Proof — mastering suite plugin descriptor.
 * Registers Proof as an effect with custom UI that opens a bottom panel.
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, effectGuidance } from './GuidanceProfiles';

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
        declaredControl(
            'Mastering control',
            'Changes final-stage tonal, dynamic, or ceiling behavior.',
            ['Compare at matched loudness against bypass.'],
            ['Aggressive settings can reduce transient detail.']
        )
    )
);
