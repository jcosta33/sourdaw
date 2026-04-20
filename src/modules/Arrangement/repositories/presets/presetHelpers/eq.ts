import { type DevicePreset } from '../../../models/SoundPreset';

export const eq = (
    name: string,
    params: Partial<
        Record<
            | 'eq-low-gain'
            | 'eq-low-freq'
            | 'eq-mid-gain'
            | 'eq-mid-freq'
            | 'eq-mid-q'
            | 'eq-high-gain'
            | 'eq-high-freq',
            number
        >
    >
): DevicePreset => ({
    type: 'builtin-eq',
    name,
    parameterValues: {
        'eq-low-gain': 0,
        'eq-low-freq': 100,
        'eq-mid-gain': 0,
        'eq-mid-freq': 1000,
        'eq-mid-q': 1,
        'eq-high-gain': 0,
        'eq-high-freq': 8000,
        ...params,
    },
});
