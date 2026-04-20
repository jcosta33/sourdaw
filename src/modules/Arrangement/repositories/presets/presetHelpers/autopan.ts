import { type DevicePreset } from '../../../models/SoundPreset';

export function autopan(
    name: string,
    params: Partial<Record<'autopan-rate' | 'autopan-depth' | 'autopan-shape', number>>
): DevicePreset {
    return {
        type: 'builtin-autopan',
        name,
        parameterValues: { 'autopan-rate': 2, 'autopan-depth': 0.7, 'autopan-shape': 0, ...params },
    };
}
