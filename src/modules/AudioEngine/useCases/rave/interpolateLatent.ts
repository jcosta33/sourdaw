import { type LatentVector } from '#/modules/AudioEngine/stores/rave';

/**
 * Interpolate between two latent vectors for morphing.
 * Pure function — linear interpolation in latent space.
 */
export function interpolateLatent(a: LatentVector, b: LatentVector, t: number): LatentVector {
    return {
        timeSec: a.timeSec * (1 - t) + b.timeSec * t,
        values: a.values.map((val, d) => val * (1 - t) + (b.values[d] ?? 0) * t),
    };
}
