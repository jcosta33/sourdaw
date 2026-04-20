import { type DevicePreset } from '../../../models/SoundPreset';

export function phaser(
    name: string,
    params: Partial<Record<'phaser-rate' | 'phaser-depth' | 'phaser-feedback' | 'phaser-stages', number>>
): DevicePreset {
    return {
        type: 'builtin-phaser',
        name,
        parameterValues: { 'phaser-rate': 0.5, 'phaser-depth': 0.5, 'phaser-feedback': 0.3, 'phaser-stages': 4, ...params },
    };
}
