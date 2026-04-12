import { type DevicePreset } from '../../../models/SoundPreset';

export const reverb = (
    name: string,
    params: Partial<Record<'rev-size' | 'rev-decay' | 'rev-damping' | 'rev-mix', number>>
): DevicePreset => ({
    type: 'builtin-reverb',
    name,
    parameterValues: {
        'rev-size': 0.5,
        'rev-decay': 2,
        'rev-damping': 0.5,
        'rev-mix': 0.3,
        ...params,
    },
});