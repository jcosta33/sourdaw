/**
 * Preserved Grand Boule physical-modeling piano descriptor.
 * Release admission withholds it from distributed discovery and construction.
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, instrumentGuidance } from './GuidanceProfiles';

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
            value: 0.7,
            defaultValue: 0.7,
            minValue: 0,
            maxValue: 2,
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
    descriptorGuidance(
        'grand-boule',
        instrumentGuidance(
            'Shape a physical-model piano from playing response, resonance, and output tone.',
            ['Keep resonance and output gain conservative when playing dense chords.'],
            ['Physical-model, hammer, resonance, and tone controls interact with note velocity.'],
            ['High resonance or output gain can build sustained energy.']
        ),
        declaredControl(
            'Physical-piano control',
            'Changes piano response, resonance, tone, or output behavior.',
            ['Balance resonance with damping and output level.'],
            ['High resonance can build sustained energy.']
        )
    )
);
