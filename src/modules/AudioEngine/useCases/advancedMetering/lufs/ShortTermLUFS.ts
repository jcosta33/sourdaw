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