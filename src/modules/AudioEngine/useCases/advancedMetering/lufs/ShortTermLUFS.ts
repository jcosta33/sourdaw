import { LOUDNESS_OFFSET } from '#/utils/audioMetering/loudnessScale';

/**
 * Short-term loudness (ITU-R BS.1770-4): three seconds of K-weighted 400 ms
 * blocks, averaged in the energy domain.
 *
 * `push` takes the `z` of a `MomentaryLUFS` block — the K-weighting lives
 * there, at the sample rate the programme runs at. Averaging energies (not
 * decibels) is the recommendation's own order of operations: the decibel figure
 * is produced once, here, on the way out.
 */

/** Block granularity BS.1770 measures at: 400 ms. */
const BLOCK_SECONDS = 0.4;
/** Short-term window: three seconds of blocks. */
const WINDOW_SECONDS = 3;

/** The reading every loudness surface reports for silence. */
const SILENCE_LUFS = -70;

/**
 * Energy-domain ring of the eight 400 ms block energies a 3 s window holds.
 *
 * The ring avoids O(n) `Array.shift()` on blocks pushed per animation frame.
 */
export class ShortTermLUFS {
    private readonly blocks: number[];
    private readonly maxBlocks: number;
    private head = 0;
    private count = 0;

    constructor() {
        this.maxBlocks = Math.ceil(WINDOW_SECONDS / BLOCK_SECONDS);
        this.blocks = Array.from({ length: this.maxBlocks }, () => 0);
    }

    /** Record one 400 ms block's K-weighted energy (`MomentaryLUFS.energy`). */
    push(blockEnergy: number): void {
        if (this.count < this.maxBlocks) {
            this.blocks[(this.head + this.count) % this.maxBlocks] = blockEnergy;
            this.count++;
        } else {
            this.blocks[this.head] = blockEnergy;
            this.head = (this.head + 1) % this.maxBlocks;
        }
    }

    /** Short-term loudness in LUFS, floored at the silence reading. */
    get value(): number {
        if (this.count === 0) {
            return SILENCE_LUFS;
        }
        let sum = 0;
        for (let index = 0; index < this.count; index++) {
            sum += this.blocks[(this.head + index) % this.maxBlocks]!;
        }
        const mean = sum / this.count;
        if (!Number.isFinite(mean) || mean <= 0) {
            return SILENCE_LUFS;
        }
        return Math.max(SILENCE_LUFS, LOUDNESS_OFFSET + 10 * Math.log10(mean));
    }
}
