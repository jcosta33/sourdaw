/**
 * Yeast — MIDI Effects Rack plugin descriptor.
 * Registers Yeast as a MIDI effect that can be added to MIDI tracks.
 */

import { type PluginDescriptor } from '../DeviceParameter';

export const YEAST_DESCRIPTOR: PluginDescriptor = {
    id: 'yeast',
    name: 'Yeast',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: [
        { id: 'arp_mode', deviceId: 'yeast', name: 'Arp Mode', type: 'int', value: 0, defaultValue: 0, minValue: 0, maxValue: 6, unit: '', automatable: true, hasAutomation: false },
        { id: 'arp_rate', deviceId: 'yeast', name: 'Rate', type: 'int', value: 8, defaultValue: 8, minValue: 1, maxValue: 32, unit: '', automatable: true, hasAutomation: false },
        { id: 'arp_gate', deviceId: 'yeast', name: 'Gate', type: 'float', value: 0.8, defaultValue: 0.8, minValue: 0.01, maxValue: 2, unit: '', automatable: true, hasAutomation: false },
        { id: 'arp_swing', deviceId: 'yeast', name: 'Swing', type: 'float', value: 0, defaultValue: 0, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false },
    ],
};
