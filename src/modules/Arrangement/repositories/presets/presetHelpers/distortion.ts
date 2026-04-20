import { type DevicePreset } from '../../../models/SoundPreset';

export const distortion = (
    name: string,
    params: Partial<Record<'dist-drive' | 'dist-tone' | 'dist-mix', number>>
): DevicePreset => ({
    type: 'builtin-distortion',
    name,
    parameterValues: { 'dist-drive': 5, 'dist-tone': 5000, 'dist-mix': 0.5, ...params },
});
