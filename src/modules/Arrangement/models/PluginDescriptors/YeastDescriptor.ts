/**
 * Yeast — MIDI Effects Rack plugin descriptor.
 * Registers Yeast as a MIDI effect that can be added to MIDI tracks.
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, effectGuidance } from './GuidanceProfiles';

const YEAST_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'yeast',
    name: 'Yeast',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: [
        {
            id: 'arp_mode',
            deviceId: 'yeast',
            name: 'Arp Mode',
            type: 'int',
            value: 0,
            defaultValue: 0,
            minValue: 0,
            maxValue: 6,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'arp_rate',
            deviceId: 'yeast',
            name: 'Rate',
            type: 'int',
            value: 8,
            defaultValue: 8,
            minValue: 1,
            maxValue: 32,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'arp_gate',
            deviceId: 'yeast',
            name: 'Gate',
            type: 'float',
            value: 0.8,
            defaultValue: 0.8,
            minValue: 0.01,
            maxValue: 2,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'arp_swing',
            deviceId: 'yeast',
            name: 'Swing',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
    ],
};

export const YEAST_DESCRIPTOR = applySingleDescriptorGuidance(
    YEAST_DESCRIPTOR_DATA,
    descriptorGuidance(
        'yeast',
        effectGuidance(
            'Transform incoming MIDI deliberately before it reaches an instrument.',
            ['Verify the target instrument and note range before enabling transformations.'],
            ['MIDI routing, scale, timing, and velocity controls jointly change generated note events.'],
            ['Unbounded transposition or dense generation can make a performance unplayable.'],
            { availability: 'not-applicable', reason: 'This MIDI effect has no audio output level to compensate.' }
        ),
        declaredControl(
            'MIDI transformation control',
            'Changes note-event routing, pitch, timing, or velocity behavior.',
            ['Verify target and note range before enabling a transformation.'],
            ['Dense or transposed output can make a performance unplayable.']
        )
    )
);
