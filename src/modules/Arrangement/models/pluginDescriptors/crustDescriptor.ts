/**
 * Crust — limiter/saturator plugin descriptor.
 */
import { type PluginDescriptor } from '../DeviceParameter';
import { CRUST_PARAMS } from '#/modules/Crust/models/CrustPatch';

export const CRUST_DESCRIPTOR: PluginDescriptor = {
    id: 'crust',
    name: 'Crust',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: CRUST_PARAMS.map((p) => ({
        id: p.id,
        deviceId: 'crust',
        name: p.label,
        type: (p.step === 1 ? 'int' : 'float') as 'float' | 'int',
        value: p.default,
        defaultValue: p.default,
        minValue: p.min,
        maxValue: p.max,
        unit: p.unit,
        automatable: true,
        hasAutomation: false,
    })),
};
