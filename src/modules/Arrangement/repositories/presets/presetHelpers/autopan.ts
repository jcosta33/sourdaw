import { type DevicePreset } from '#/modules/Arrangement/models/SoundPreset';

export const autopan = (
    name: string,
    params: Partial<Record<'autopan-rate' | 'autopan-depth' | 'autopan-shape', number>>
): DevicePreset => ({
    type: 'builtin-autopan',
    name,
    parameterValues: { 'autopan-rate': 2, 'autopan-depth': 0.7, 'autopan-shape': 0, ...params },
});