/**
 * Grand Boule physical-modeling piano descriptor.
 * Registers Grand Boule as an instrument for MIDI tracks.
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { GRAND_BOULE_GUIDANCE, GRAND_BOULE_PARAMETER_GUIDANCE } from './GrandBouleDescriptorGuidance';

const GRAND_BOULE_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'grand-boule',
    name: 'Grand Boule',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'instrument',
    hasCustomUI: true,
    parameters: [
        {
            id: 'masterGain',
            deviceId: 'grand-boule',
            name: 'Master',
            type: 'float',
            value: 0.1,
            defaultValue: 0.1,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'soundboardSend',
            deviceId: 'grand-boule',
            name: 'Soundboard',
            type: 'float',
            value: 0.6,
            defaultValue: 0.6,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'sympatheticSend',
            deviceId: 'grand-boule',
            name: 'Sympathetic',
            type: 'float',
            value: 0.25,
            defaultValue: 0.25,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'lidPosition',
            deviceId: 'grand-boule',
            name: 'Lid Position',
            type: 'float',
            value: 1,
            defaultValue: 1,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'micPosition',
            deviceId: 'grand-boule',
            name: 'Microphone Position',
            type: 'int',
            value: 1,
            defaultValue: 1,
            minValue: 0,
            maxValue: 2,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
    ],
};

export const GRAND_BOULE_DESCRIPTOR = applySingleDescriptorGuidance(
    GRAND_BOULE_DESCRIPTOR_DATA,
    // No fallback: every parameter is authored in GrandBouleDescriptorGuidance.ts.
    descriptorGuidance('grand-boule', GRAND_BOULE_GUIDANCE, undefined, GRAND_BOULE_PARAMETER_GUIDANCE)
);
