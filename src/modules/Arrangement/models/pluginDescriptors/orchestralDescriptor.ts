/**
 * Orchestral — orchestral instrument plugin descriptor.
 * Registers the Orchestral suite as a proper instrument that can be added to MIDI tracks.
 */

import { type PluginDescriptor } from '../DeviceParameter';

export const ORCHESTRAL_DESCRIPTOR: PluginDescriptor = {
    id: 'orchestral',
    name: 'Orchestral',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'instrument',
    hasCustomUI: true,
    parameters: [
        { id: 'masterGain', deviceId: 'orchestral', name: 'Master', type: 'float', value: 0.8, defaultValue: 0.8, minValue: 0, maxValue: 2, unit: '', automatable: true, hasAutomation: false },
        { id: 'humanize', deviceId: 'orchestral', name: 'Humanize', type: 'float', value: 0.5, defaultValue: 0.5, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false },
        { id: 'vibratoDepth', deviceId: 'orchestral', name: 'Vibrato', type: 'float', value: 0, defaultValue: 0, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false },
        { id: 'legatoEnabled', deviceId: 'orchestral', name: 'Legato', type: 'bool', value: 1, defaultValue: 1, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false },
        { id: 'autoDivisi', deviceId: 'orchestral', name: 'Auto-Divisi', type: 'bool', value: 0, defaultValue: 0, minValue: 0, maxValue: 1, unit: '', automatable: false, hasAutomation: false },
        { id: 'ensembleTiming', deviceId: 'orchestral', name: 'Ensemble', type: 'bool', value: 0, defaultValue: 0, minValue: 0, maxValue: 1, unit: '', automatable: false, hasAutomation: false },
    ],
};
