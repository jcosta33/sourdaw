import { type DevicePreset } from '#/modules/Arrangement/models/SoundPreset';

export const phaser = (
    name: string,
    params: Partial<Record<'phaser-rate' | 'phaser-depth' | 'phaser-feedback' | 'phaser-stages', number>>
): DevicePreset => ({
    type: 'builtin-phaser',
    name,
    parameterValues: { 'phaser-rate': 0.5, 'phaser-depth': 0.5, 'phaser-feedback': 0.3, 'phaser-stages': 4, ...params },
});