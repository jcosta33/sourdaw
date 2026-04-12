import { type DevicePreset } from '../../../models/SoundPreset';

export const chorus = (
    name: string,
    params: Partial<Record<'chorus-rate' | 'chorus-depth' | 'chorus-feedback' | 'chorus-mix', number>>
): DevicePreset => ({
    type: 'builtin-chorus',
    name,
    parameterValues: { 'chorus-rate': 1.5, 'chorus-depth': 7, 'chorus-feedback': 0.2, 'chorus-mix': 0.5, ...params },
});