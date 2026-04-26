import { type DevicePreset } from '../../../models/SoundPreset';

export function tremolo(
    name: string,
    params: Partial<Record<'trem-rate' | 'trem-depth' | 'trem-shape', number>>
): DevicePreset {
    return {
        type: 'builtin-tremolo',
        name,
        parameterValues: { 'trem-rate': 4, 'trem-depth': 0.5, 'trem-shape': 0, ...params },
    };
}
