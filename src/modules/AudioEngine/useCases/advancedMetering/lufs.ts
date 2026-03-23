/**
 * LUFS / EBU R128 loudness metering.
 *
 * TODO: K-weighting is approximated with a first-order high-frequency emphasis filter.
 * For production-grade LUFS, an AudioWorklet with proper biquad K-weighting filters would be ideal.
 */

/**
 * Compute momentary loudness (400ms window) in LUFS from raw PCM samples.
 * Uses a simplified K-weighting approximation.
 */
export function computeMomentaryLUFS(samples: Float32Array, sampleRate = 48000): number {
    if (samples.length === 0) {
        return -70;
    }

    const windowSamples = Math.min(samples.length, Math.floor(sampleRate * 0.4));
    const start = samples.length - windowSamples;

    let sumSquares = 0;
    let prevSample = 0;
    for (let i = start; i < samples.length; i++) {
        const s = samples[i]!;
        const filtered = s - 0.85 * prevSample;
        prevSample = s;
        sumSquares += filtered * filtered;
    }

    const meanSquare = sumSquares / windowSamples;

    if (meanSquare <= 0) {
        return -70;
    }

    const lufs = -0.691 + 10 * Math.log10(meanSquare);
    return Math.max(-70, lufs);
}

/**
 * Short-term loudness (3s window) in LUFS.
 * Accumulates multiple 400ms blocks.
 */
export class ShortTermLUFS {
    private readonly blocks: number[] = [];
    private readonly maxBlocks: number;

    constructor(sampleRate = 48000) {
        this.maxBlocks = Math.ceil((3 * sampleRate) / (0.4 * sampleRate));
    }

    push(momentaryLUFS: number): void {
        this.blocks.push(momentaryLUFS);
        if (this.blocks.length > this.maxBlocks) {
            this.blocks.shift();
        }
    }

    get value(): number {
        if (this.blocks.length === 0) {
            return -70;
        }
        let sum = 0;
        for (const lufs of this.blocks) {
            sum += 10 ** (lufs / 10);
        }
        const avg = sum / this.blocks.length;
        if (avg <= 0) {
            return -70;
        }
        return Math.max(-70, 10 * Math.log10(avg));
    }
}

/**
 * Integrated LUFS with absolute gating (-70 LUFS threshold).
 * Accumulates all blocks for full-track measurement.
 */
export class IntegratedLUFS {
    private readonly allBlocks: number[] = [];

    push(momentaryLUFS: number): void {
        if (momentaryLUFS > -70) {
            this.allBlocks.push(momentaryLUFS);
        }
    }

    get value(): number {
        if (this.allBlocks.length === 0) {
            return -70;
        }
        let sum = 0;
        for (const lufs of this.allBlocks) {
            sum += 10 ** (lufs / 10);
        }
        const avg = sum / this.allBlocks.length;
        return avg <= 0 ? -70 : Math.max(-70, 10 * Math.log10(avg));
    }

    reset(): void {
        this.allBlocks.length = 0;
    }
}
