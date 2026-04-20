import { type DevicePreset } from '../../../models/SoundPreset';

export function distortion(
    name: string,
    params: Partial<Record<'dist-drive' | 'dist-tone' | 'dist-mix', number>>
): DevicePreset {
    return {
        type: 'builtin-distortion',
        name,
        parameterValues: { 'dist-drive': 5, 'dist-tone': 5000, 'dist-mix': 0.5, ...params },
    };
}
