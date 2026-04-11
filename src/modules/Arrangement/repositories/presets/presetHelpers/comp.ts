import { type DevicePreset } from '#/modules/Arrangement/models/SoundPreset';

export const comp = (
    name: string,
    params: Partial<Record<'comp-threshold' | 'comp-ratio' | 'comp-attack' | 'comp-release' | 'comp-makeup', number>>
): DevicePreset => ({
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
});