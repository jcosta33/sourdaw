/**
 * VU meter with 300ms rise/fall ballistics correlating with perceived loudness.
 */
export class VUMeter {
    private current = 0;
    private peakHold = 0;
    private peakHoldTime = 0;

    private static readonly RISE_TIME = 0.3;
    private static readonly FALL_TIME = 0.3;
    private static readonly PEAK_HOLD_DURATION = 1.5;

    /**
     * Update VU level from raw samples.
     * @param samples - Float32Array of audio samples
     * @param deltaTime - Time since last update in seconds
     * @returns Current VU level (0-1 linear scale)
     */
    update(samples: Float32Array, deltaTime: number): number {
        let sumSquares = 0;
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i]!;
            sumSquares += s * s;
        }
        const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;

        const riseCoeff = 1 - Math.exp(-deltaTime / VUMeter.RISE_TIME);
        const fallCoeff = 1 - Math.exp(-deltaTime / VUMeter.FALL_TIME);

        if (rms > this.current) {
            this.current += (rms - this.current) * riseCoeff;
        } else {
            this.current += (rms - this.current) * fallCoeff;
        }

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
