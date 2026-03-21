/**
 * Advanced metering use cases.
 * Computes LUFS (EBU R128), VU (with ballistics), phase correlation,
 * and oscilloscope data from AnalyserNode time-domain data.
 *
 * All functions accept a Float32Array from getFloatTimeDomainData().
 */

// ─── LUFS / EBU R128 ──────────────────────────────────────────────

/**
 * K-weighting pre-filter coefficients for 48kHz.
 * Two cascaded biquad filters:
 *   Stage 1: High-shelf (+4dB at high frequencies)
 *   Stage 2: High-pass (~38Hz, revised low-frequency)
 *
 * For simplicity, we approximate K-weighting using a single-pass RMS
 * with a high-frequency emphasis. For production-grade LUFS, an
 * AudioWorklet with proper biquad filters would be ideal, but this
 * provides a good approximation from AnalyserNode data.
 */

/**
 * Compute momentary loudness (400ms window) in LUFS from raw PCM samples.
 * This uses a simplified K-weighting approximation.
 *
 * @param samples - Float32Array of audio samples (mono or interleaved)
 * @param sampleRate - Audio context sample rate (default 48000)
 * @returns Loudness in LUFS (typically -70 to 0)
 */
export function computeMomentaryLUFS(samples: Float32Array, sampleRate = 48000): number {
    if (samples.length === 0) {
        return -70;
    }

    // Use only the last 400ms of data
    const windowSamples = Math.min(samples.length, Math.floor(sampleRate * 0.4));
    const start = samples.length - windowSamples;

    // Mean-square with K-weighting approximation
    // Apply simple high-frequency emphasis (approximate stage 1 shelf)
    let sumSquares = 0;
    let prevSample = 0;
    for (let i = start; i < samples.length; i++) {
        const s = samples[i]!;
        // First-order high-frequency emphasis: y[n] = x[n] - 0.85 * x[n-1]
        // This approximates the high-shelf boost of K-weighting
        const filtered = s - 0.85 * prevSample;
        prevSample = s;
        sumSquares += filtered * filtered;
    }

    const meanSquare = sumSquares / windowSamples;

    if (meanSquare <= 0) {
        return -70;
    }

    // LUFS = -0.691 + 10 * log10(mean_square)
    const lufs = -0.691 + 10 * Math.log10(meanSquare);
    return Math.max(-70, lufs);
}

/**
 * Compute short-term loudness (3s window) in LUFS.
 * Accumulates multiple 400ms blocks.
 */
export class ShortTermLUFS {
    private readonly blocks: number[] = [];
    private readonly maxBlocks: number;

    constructor(sampleRate = 48000) {
        // 3 seconds / 400ms = 7.5 blocks, use 8
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
        // Average the linear powers
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
        // Absolute gate: discard blocks below -70 LUFS
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

// ─── VU Meter with Ballistics ──────────────────────────────────────

/**
 * VU meter with 300ms rise/fall ballistics correlating with perceived loudness.
 */
export class VUMeter {
    private current = 0;
    private peakHold = 0;
    private peakHoldTime = 0;

    private static readonly RISE_TIME = 0.3; // 300ms rise
    private static readonly FALL_TIME = 0.3; // 300ms fall
    private static readonly PEAK_HOLD_DURATION = 1.5; // Hold peak for 1.5s

    /**
     * Update VU level from raw samples.
     * @param samples - Float32Array of audio samples
     * @param deltaTime - Time since last update in seconds
     * @returns Current VU level (0-1 linear scale)
     */
    update(samples: Float32Array, deltaTime: number): number {
        // Compute RMS
        let sumSquares = 0;
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i]!;
            sumSquares += s * s;
        }
        const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;

        // Apply ballistics
        const riseCoeff = 1 - Math.exp(-deltaTime / VUMeter.RISE_TIME);
        const fallCoeff = 1 - Math.exp(-deltaTime / VUMeter.FALL_TIME);

        if (rms > this.current) {
            this.current += (rms - this.current) * riseCoeff;
        } else {
            this.current += (rms - this.current) * fallCoeff;
        }

        // Peak hold
        if (this.current > this.peakHold) {
            this.peakHold = this.current;
            this.peakHoldTime = 0;
        } else {
            this.peakHoldTime += deltaTime;
            if (this.peakHoldTime > VUMeter.PEAK_HOLD_DURATION) {
                this.peakHold *= 1 - fallCoeff;
            }
        }

        return this.current;
    }

    get level(): number {
        return this.current;
    }

    get peak(): number {
        return this.peakHold;
    }

    reset(): void {
        this.current = 0;
        this.peakHold = 0;
        this.peakHoldTime = 0;
    }
}

// ─── Phase Correlation Meter ───────────────────────────────────────

/**
 * Compute phase correlation between left and right channels.
 *
 * Result ranges from -1 (fully out of phase) to +1 (fully correlated/mono).
 * 0 = uncorrelated stereo.
 *
 * @param left - Left channel samples
 * @param right - Right channel samples
 * @returns Correlation coefficient (-1 to +1)
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
        return 1; // Silence = fully correlated
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
