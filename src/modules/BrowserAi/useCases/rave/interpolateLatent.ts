import { type LatentVector } from '../../stores/rave';

/**
 * Interpolate between two latent vectors for morphing.
 * Pure function — linear interpolation in latent space.
 */
export function interpolateLatent(alpha: LatentVector, b: LatentVector, time: number): LatentVector {
    return {
        timeSec: alpha.timeSec * (1 - time) + b.timeSec * time,
        values: alpha.values.map((val, data) => val * (1 - time) + (b.values[data] ?? 0) * time),
    };
}
