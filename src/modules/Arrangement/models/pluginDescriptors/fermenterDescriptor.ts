/**
 * Fermenter — master synth plugin descriptor.
 * Registers Fermenter as a proper instrument that can be added to MIDI tracks.
 */

import { type PluginDescriptor } from '../DeviceParameter';
import { FERMENTER_PARAMS } from '#/modules/Fermenter/useCases/fermenterQueries';

export const FERMENTER_DESCRIPTOR: PluginDescriptor = {
    id: 'fermenter',
    name: 'Fermenter',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'instrument',
    hasCustomUI: true,
    parameters: FERMENTER_PARAMS.map((p) => ({
        id: p.id,
        deviceId: 'fermenter',
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
