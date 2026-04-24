/**
 * Transformer: pure velocity curve functions.
 * No I/O — applies mathematical curves to normalized velocity values.
 */

export type VelocityCurve = 'linear' | 'exponential' | 'logarithmic' | 's-curve' | 'compress' | 'expand';

export function applyVelocityCurve(normalized: number, curve: VelocityCurve): number {
    switch (curve) {
        case 'linear': {
            return normalized;
        }
        case 'exponential': {
            return normalized * normalized;
        }
        case 'logarithmic': {
            return Math.sqrt(normalized);
        }
        case 's-curve': {
            if (normalized < 0.5) {
                return 2 * normalized * normalized;
            }
            return 1 - 2 * (1 - normalized) * (1 - normalized);
        }
        case 'compress': {
            return 0.3 + normalized * 0.4;
        }
        case 'expand': {
            if (normalized < 0.5) {
                return normalized * 0.3;
            }
            return 0.7 + (normalized - 0.5) * 1.4;
        }
        default:
            throw new Error(`Unknown velocity curve: ${curve}`);
    }
}
