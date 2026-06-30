/**
 * Grand Boule — physical-modeling piano plugin descriptor.
 * Registers Grand Boule as an instrument that can be added to MIDI tracks.
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

export const GRAND_BOULE_DESCRIPTOR: PluginDescriptor = {
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
    ],
};
