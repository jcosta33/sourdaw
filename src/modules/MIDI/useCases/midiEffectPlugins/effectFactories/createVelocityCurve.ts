import { type MidiEffect } from '../../../models/MidiEffectTypes';

export function createVelocityCurve(
    curve: 'linear' | 'soft' | 'hard' | 'fixed' = 'linear',
    fixedVel = 100
): MidiEffect {
    return {
        id: 'midi-fx-velocity-curve',
        name: `Velocity Curve (${curve})`,
        process: (notes) =>
            notes.map((node) => {
                let vel = node.velocity;
                switch (curve) {
                    case 'soft':
                        vel = Math.round(Math.sqrt(vel / 127) * 127);
                        break;
                    case 'hard':
                        vel = Math.round((vel / 127) ** 2 * 127);
                        break;
                    case 'fixed':
                        vel = fixedVel;
                        break;
                    case 'linear':
                    default:
                        break;
                }
                return { ...node, velocity: Math.max(1, Math.min(127, vel)) };
            }),
    };
}
