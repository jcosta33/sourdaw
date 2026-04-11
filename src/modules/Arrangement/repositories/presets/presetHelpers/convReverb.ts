import { type DevicePreset } from '#/modules/Arrangement/models/SoundPreset';

export const convReverb = (
    name: string,
    params: Partial<Record<'conv-ir' | 'conv-mix' | 'conv-predelay' | 'conv-lowcut' | 'conv-highcut', number>>
): DevicePreset => ({
    type: 'builtin-convolution-reverb',
    name,
    parameterValues: {
        'conv-ir': 6,
        'conv-mix': 0.4,
        'conv-predelay': 10,
        'conv-lowcut': 60,
        'conv-highcut': 12000,
        ...params,
    },
});