/**
 * Short-term loudness (3s window) in LUFS.
 * Accumulates multiple 400ms blocks.
 *
 * Uses a ring buffer to avoid O(n) Array.shift() on the audio thread.
 */
export class ShortTermLUFS {
    private readonly blocks: number[];
    private readonly maxBlocks: number;
    private head = 0;
    private count = 0;

    constructor(sampleRate = 48000) {
        this.maxBlocks = Math.ceil((3 * sampleRate) / (0.4 * sampleRate));
        this.blocks = Array.from({ length: this.maxBlocks }, () => 0);
    }

    push(momentaryLUFS: number): void {
        if (this.count < this.maxBlocks) {
            this.blocks[(this.head + this.count) % this.maxBlocks] = momentaryLUFS;
            this.count++;
        } else {
            this.blocks[this.head] = momentaryLUFS;
            this.head = (this.head + 1) % this.maxBlocks;
        }
    }

    get value(): number {
        if (this.count === 0) {
            return -70;
        }
        let sum = 0;
        for (let index = 0; index < this.count; index++) {
            sum += 10 ** (this.blocks[(this.head + index) % this.maxBlocks]! / 10);
        }
        const avg = sum / this.count;
        if (avg <= 0) {
            return -70;
        }
        return Math.max(-70, 10 * Math.log10(avg));
    }
}
