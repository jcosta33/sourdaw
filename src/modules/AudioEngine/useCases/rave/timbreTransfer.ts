import { type LatentVector } from '../../stores/rave';

/**
 * Perform timbre transfer: blend source and target latent vectors.
 * Pure function — no side effects.
 */
export function timbreTransfer(
    sourceVectors: LatentVector[],
    targetVectors: LatentVector[],
    blend: number
): LatentVector[] {
    const clampedBlend = Math.max(0, Math.min(1, blend));

    return sourceVectors.map((sv, i) => {
        const tv = targetVectors[i % targetVectors.length];
        if (!tv) {
            return sv;
        }

        return {
            timeSec: sv.timeSec,
            values: sv.values.map((val, d) => {
                const targetVal = tv.values[d] ?? 0;
                return val * (1 - clampedBlend) + targetVal * clampedBlend;
            }),
        };
    });
}
