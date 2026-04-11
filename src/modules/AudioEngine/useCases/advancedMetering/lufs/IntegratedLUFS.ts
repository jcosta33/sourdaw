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