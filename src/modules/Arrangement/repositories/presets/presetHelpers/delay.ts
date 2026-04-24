import { type DevicePreset } from '../../../models/SoundPreset';

export function delay(
    name: string,
    params: Partial<Record<'delay-time' | 'delay-feedback' | 'delay-mix', number>>
): DevicePreset {
    return {
        type: 'builtin-delay',
        name,
        parameterValues: {
            'delay-time': 250,
            'delay-feedback': 0.4,
            'delay-mix': 0.3,
            ...params,
        },
    };
}
