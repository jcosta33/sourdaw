/**
 * Fermenter — master synth plugin descriptor.
 * Registers Fermenter as a proper instrument that can be added to MIDI tracks.
 */

import { FERMENTER_PARAMS } from '#/modules/Fermenter/useCases';

import { type PluginDescriptor } from '../DeviceParameterTypes';

export const FERMENTER_DESCRIPTOR: PluginDescriptor = {
    id: 'fermenter',
    name: 'Fermenter',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'instrument',
    hasCustomUI: true,
    parameters: FERMENTER_PARAMS.map((param) => ({
        id: param.id,
        deviceId: 'fermenter',
        name: param.label,
        type: param.step === 1 ? 'int' : 'float',
        value: param.default,
        defaultValue: param.default,
        minValue: param.min,
        maxValue: param.max,
        unit: param.unit,
        scaling: param.scaling,
        automatable: true,
        hasAutomation: false,
    })),
};
