/**
 * Proof — mastering suite plugin descriptor.
 * Registers Proof as an effect with custom UI that opens a bottom panel.
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

export const PROOF_DESCRIPTOR: PluginDescriptor = {
    id: 'proof',
    name: 'Proof',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: [
        {
            id: 'input_gain',
            deviceId: 'proof',
            name: 'Input Gain',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: -24,
            maxValue: 24,
            unit: 'dB',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'output_gain',
            deviceId: 'proof',
            name: 'Output Gain',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: -24,
            maxValue: 24,
            unit: 'dB',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'lim_ceiling',
            deviceId: 'proof',
            name: 'Ceiling',
            type: 'float',
            value: -1,
            defaultValue: -1,
            minValue: -12,
            maxValue: 0,
            unit: 'dB',
            automatable: true,
            hasAutomation: false,
        },
    ],
};
