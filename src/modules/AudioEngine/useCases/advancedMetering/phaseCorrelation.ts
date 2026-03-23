/**
 * Phase correlation measurement between left and right channels.
 * Result ranges from -1 (fully out of phase) to +1 (fully correlated/mono).
 */

/**
 * Compute phase correlation between left and right channels.
 */
export function computePhaseCorrelation(left: Float32Array, right: Float32Array): number {
    const len = Math.min(left.length, right.length);
    if (len === 0) {
        return 1;
    }

    let sumLR = 0;
    let sumLL = 0;
    let sumRR = 0;

    for (let i = 0; i < len; i++) {
        const l = left[i]!;
        const r = right[i]!;
        sumLR += l * r;
        sumLL += l * l;
        sumRR += r * r;
    }

    const denominator = Math.sqrt(sumLL * sumRR);
    if (denominator < 1e-10) {
        return 1;
    }

    return sumLR / denominator;
}

/**
 * Phase correlation meter with smoothing.
 */
export class PhaseCorrelationMeter {
    private current = 1;
    private static readonly SMOOTHING = 0.85;

    update(left: Float32Array, right: Float32Array): number {
        const raw = computePhaseCorrelation(left, right);
        this.current = PhaseCorrelationMeter.SMOOTHING * this.current + (1 - PhaseCorrelationMeter.SMOOTHING) * raw;
        return this.current;
    }

    get value(): number {
        return this.current;
    }

    reset(): void {
        this.current = 1;
    }
}
