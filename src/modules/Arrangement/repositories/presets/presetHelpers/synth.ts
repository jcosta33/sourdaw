import { type DevicePreset } from '../../../models/SoundPreset';

export const synth = (name: string, params: Record<string, number>): DevicePreset => ({
    type: 'builtin-synth',
    name,
    parameterValues: params,
});
