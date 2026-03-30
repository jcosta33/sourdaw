/**
 * Grinder — amp simulator, cabinet, pedalboard, neural capture plugin descriptor.
 */

import { type PluginDescriptor } from '../DeviceParameter';
import { GRINDER_PARAMS } from '#/modules/Grinder/models/GrinderPatch';

export const GRINDER_DESCRIPTOR: PluginDescriptor = {
    id: 'grinder',
    name: 'Grinder',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: GRINDER_PARAMS.map((p) => ({
        id: p.id,
        deviceId: 'grinder',
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
