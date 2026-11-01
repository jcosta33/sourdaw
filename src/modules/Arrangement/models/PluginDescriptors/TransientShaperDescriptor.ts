import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance } from './DescriptorGuidance';
import { TRANSIENT_SHAPER_GUIDANCE } from './TransientShaperDescriptorGuidance';

const descriptor: PluginDescriptor = {
    id: 'transient-shaper',
    name: 'Transient Shaper',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    platform: 'both',
    hasCustomUI: false,
    parameters: [
        { id: 'attackGain', name: 'Attack gain' },
        { id: 'sustainGain', name: 'Sustain gain' },
    ].map((parameter) => ({
        ...parameter,
        deviceId: 'transient-shaper',
        type: 'float',
        value: 1,
        defaultValue: 1,
        minValue: 0,
        maxValue: 2,
        unit: 'x',
        automatable: true,
        hasAutomation: false,
    })),
};

export const TRANSIENT_SHAPER_DESCRIPTOR = applySingleDescriptorGuidance(descriptor, TRANSIENT_SHAPER_GUIDANCE);
