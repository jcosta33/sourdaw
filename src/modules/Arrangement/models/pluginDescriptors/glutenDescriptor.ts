/**
 * Gluten — multi-topology bus compressor plugin descriptor.
 * Registers Gluten as an effect that can be added to any track.
 */

import { type PluginDescriptor } from '../DeviceParameter';
import { GLUTEN_PARAMS } from '#/modules/Gluten/models/GlutenPatch';

export const GLUTEN_DESCRIPTOR: PluginDescriptor = {
    id: 'gluten',
    name: 'Gluten',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: GLUTEN_PARAMS.map((p) => ({
        id: p.id,
        deviceId: 'gluten',
        name: p.label,
        type: (p.step === 1 ? 'int' : 'float') as 'float' | 'int',
        value: p.default,
        defaultValue: p.default,
        minValue: p.min,
        maxValue: p.max,
        unit: p.unit,
        scaling: p.scaling,
        automatable: true,
        hasAutomation: false,
    })),
};
