import { type DevicePreset } from '../../../models/SoundPreset';

export function filter(
    name: string,
    params: Partial<Record<'filter-cutoff' | 'filter-resonance' | 'filter-type', number>>
): DevicePreset {
    return {
        type: 'builtin-filter',
        name,
        parameterValues: { 'filter-cutoff': 1000, 'filter-resonance': 1, 'filter-type': 0, ...params },
    };
}
