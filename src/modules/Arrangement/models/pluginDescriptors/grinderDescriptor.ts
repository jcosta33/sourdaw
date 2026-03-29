/**
 * Grinder — drum machine plugin descriptor.
 * Registers Grinder as a proper instrument that can be added to MIDI tracks.
 */

import { type PluginDescriptor } from '../DeviceParameter';

export const GRINDER_DESCRIPTOR: PluginDescriptor = {
    id: 'grinder',
    name: 'Grinder',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'instrument',
    hasCustomUI: true,
    parameters: [
        { id: 'masterGain', deviceId: 'grinder', name: 'Master', type: 'float', value: 1, defaultValue: 1, minValue: 0, maxValue: 2, unit: '', automatable: true, hasAutomation: false },
        { id: 'reverbMix', deviceId: 'grinder', name: 'Reverb', type: 'float', value: 0.15, defaultValue: 0.15, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false },
        { id: 'delayMix', deviceId: 'grinder', name: 'Delay', type: 'float', value: 0, defaultValue: 0, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false },
        { id: 'swing', deviceId: 'grinder', name: 'Swing', type: 'float', value: 0, defaultValue: 0, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false },
    ],
};
