/**
 * Bacteria — creative multi-effects framework plugin descriptor.
 * Registers Bacteria as an effect that can be added to any track.
 */

import { type PluginDescriptor } from '../DeviceParameter';
import { BACTERIA_PARAMS } from '#/modules/Bacteria/models/BacteriaPatch';

export const BACTERIA_DESCRIPTOR: PluginDescriptor = {
    id: 'bacteria',
    name: 'Bacteria',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: BACTERIA_PARAMS.map((p) => ({
        id: p.id,
        deviceId: 'bacteria',
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
