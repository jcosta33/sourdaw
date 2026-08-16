/**
 * Levain — levain instrument plugin descriptor.
 * Registers the Levain suite as a proper instrument that can be added to MIDI tracks.
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, instrumentGuidance } from './GuidanceProfiles';

const LEVAIN_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'levain',
    name: 'Levain',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'instrument',
    hasCustomUI: true,
    parameters: [
        {
            id: 'masterGain',
            deviceId: 'levain',
            name: 'Master',
            type: 'float',
            value: 0.8,
            defaultValue: 0.8,
            minValue: 0,
            maxValue: 2,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'humanize',
            deviceId: 'levain',
            name: 'Humanize',
            type: 'float',
            value: 0.5,
            defaultValue: 0.5,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'vibratoDepth',
            deviceId: 'levain',
            name: 'Vibrato',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'legatoEnabled',
            deviceId: 'levain',
            name: 'Legato',
            type: 'bool',
            value: 1,
            defaultValue: 1,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'autoDivisi',
            deviceId: 'levain',
            name: 'Auto-Divisi',
            type: 'bool',
            value: 0,
            defaultValue: 0,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: false,
            hasAutomation: false,
        },
        {
            id: 'ensembleTiming',
            deviceId: 'levain',
            name: 'Ensemble',
            type: 'bool',
            value: 0,
            defaultValue: 0,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: false,
            hasAutomation: false,
        },
    ],
};

export const LEVAIN_DESCRIPTOR = applySingleDescriptorGuidance(
    LEVAIN_DESCRIPTOR_DATA,
    descriptorGuidance(
        'levain',
        instrumentGuidance(
            'Use the instrument controls to establish its source character before balancing level in the track.',
            ['Leave output headroom before adding bus effects.'],
            ['Voice controls and output staging jointly determine how the instrument sits in the mix.'],
            ['High output settings can overload later processing.']
        ),
        declaredControl(
            'Levain instrument control',
            'Changes the instrument response, tone, or output behavior.',
            ['Balance sound-shaping controls before output level.'],
            ['High output settings can overload later devices.']
        )
    )
);
