import { type DevicePreset } from '../../../models/SoundPreset';

export const limiter = (
    name: string,
    params: Partial<Record<'lim-threshold' | 'lim-release', number>>
): DevicePreset => ({
    type: 'builtin-limiter',
    name,
    parameterValues: { 'lim-threshold': -1, 'lim-release': 0.1, ...params },
});
