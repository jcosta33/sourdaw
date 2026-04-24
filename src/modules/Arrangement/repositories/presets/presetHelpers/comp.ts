import { type DevicePreset } from '../../../models/SoundPreset';

export function comp(
    name: string,
    params: Partial<Record<'comp-threshold' | 'comp-ratio' | 'comp-attack' | 'comp-release' | 'comp-makeup', number>>
): DevicePreset {
    return {
        type: 'builtin-compressor',
        name,
        parameterValues: {
            'comp-threshold': -20,
            'comp-ratio': 4,
            'comp-attack': 10,
            'comp-release': 100,
            'comp-makeup': 0,
            ...params,
        },
    };
}
