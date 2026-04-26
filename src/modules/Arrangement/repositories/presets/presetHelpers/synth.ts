import { type DevicePreset } from '../../../models/SoundPreset';

export function synth(name: string, params: Record<string, number>): DevicePreset {
    return {
        type: 'builtin-synth',
        name,
        parameterValues: params,
    };
}
