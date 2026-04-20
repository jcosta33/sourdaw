import { type DevicePreset } from '../../../models/SoundPreset';

export const flanger = (
    name: string,
    params: Partial<Record<'flanger-rate' | 'flanger-depth' | 'flanger-feedback' | 'flanger-mix', number>>
): DevicePreset => ({
    type: 'builtin-flanger',
    name,
    parameterValues: {
        'flanger-rate': 0.3,
        'flanger-depth': 3,
        'flanger-feedback': 0.5,
        'flanger-mix': 0.5,
        ...params,
    },
});
