import { type DevicePreset } from '../../../models/SoundPreset';

export const bitcrusher = (
    name: string,
    params: Partial<Record<'crush-bits' | 'crush-rate' | 'crush-mix', number>>
): DevicePreset => ({
    type: 'builtin-bitcrusher',
    name,
    parameterValues: { 'crush-bits': 8, 'crush-rate': 1, 'crush-mix': 0.5, ...params },
});