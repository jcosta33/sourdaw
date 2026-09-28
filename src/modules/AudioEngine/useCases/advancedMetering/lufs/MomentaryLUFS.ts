import { createKWeightingFilters, type LoudnessBiquad } from '#/utils/audioMetering/createKWeightingFilters';
import { LOUDNESS_OFFSET } from '#/utils/audioMetering/loudnessScale';

/**
 * Momentary loudness (ITU-R BS.1770-4): the K-weighted energy of a sliding
 * 400 ms window, streamed through persistent filter state.
 *
 * The K-weighting biquads come from `createKWeightingFilters`, the shared
 * source of truth in `#/utils/audioMetering` that derives both stages from the
 * recommendation's parameters at the actual sample rate; this module owns the
 * streaming that the batch (`measureIntegratedLoudness`, offline) paths do not
 * need. It is the TypeScript twin of `MomentaryLufs` in
 * `crates/daw-dsp/src/proof/metering.rs`, which the built-in LUFS meter device
 * reads — the two must stay one measurement.
 */

/** BS.1770-4 momentary window: 400 ms. */
const MOMENTARY_WINDOW_SECONDS = 0.4;

/** The reading every loudness surface reports for silence. */
const SILENCE_LUFS = -70;

/**
 * One channel's K-weighting cascade — the stage-1 high shelf followed by the
 * stage-2 RLB high-pass — with filter state carried across pushes, so a
 * window's readings never restart the filters mid-programme.
 */
class KWeightingCascade {
    private readonly shelf: LoudnessBiquad;
    private readonly highPass: LoudnessBiquad;
    private input1 = 0;
    private input2 = 0;
    private shelfOut1 = 0;
    private shelfOut2 = 0;
    private highPassOut1 = 0;
    private highPassOut2 = 0;

    constructor(sampleRate: number) {
        const { shelf, highPass } = createKWeightingFilters(sampleRate);
        this.shelf = shelf;
        this.highPass = highPass;
    }

    process(sample: number): number {
        const shelfOut =
            this.shelf.b0 * sample +
            this.shelf.b1 * this.input1 +
            this.shelf.b2 * this.input2 -
            this.shelf.a1 * this.shelfOut1 -
            this.shelf.a2 * this.shelfOut2;
        this.input2 = this.input1;
        this.input1 = sample;

        // Stage 2 filters the stage-1 output; its input delay words are the
        // shelf's output history, as in the Rust twin's `KWeightingFilter`.
        const highPassOut =
            this.highPass.b0 * shelfOut +
            this.highPass.b1 * this.shelfOut1 +
            this.highPass.b2 * this.shelfOut2 -
            this.highPass.a1 * this.highPassOut1 -
            this.highPass.a2 * this.highPassOut2;
        this.shelfOut2 = this.shelfOut1;
        this.shelfOut1 = shelfOut;
        this.highPassOut2 = this.highPassOut1;
        this.highPassOut1 = highPassOut;
        return highPassOut;
    }
}

/**
 * Streaming momentary LUFS over the master tap's left/right chunks.
 *
 * `push` filters each chunk through the persistent K-weighting cascade into a
 * 400 ms ring of filtered samples whose running energy is the `z` of
 * BS.1770-4's block loudness `L = -0.691 + 10·log10(z)`. Channel energies are
 * summed with weight 1 — G = 1 for L and R per the recommendation's Table 4 —
 * never averaged; the averaged form reads every stereo signal 3.01 LU low.
 */
export class MomentaryLUFS {
    private readonly left: KWeightingCascade;
    private readonly right: KWeightingCascade;
    private readonly filteredLeft: Float64Array;
    private readonly filteredRight: Float64Array;
    private readonly windowFrames: number;
    private writeIndex = 0;
    private processedFrames = 0;
    private sumSquaresLeft = 0;
    private sumSquaresRight = 0;

    constructor(sampleRate: number) {
        this.windowFrames = Math.max(1, Math.round(MOMENTARY_WINDOW_SECONDS * sampleRate));
        this.left = new KWeightingCascade(sampleRate);
        this.right = new KWeightingCascade(sampleRate);
        this.filteredLeft = new Float64Array(this.windowFrames);
        this.filteredRight = new Float64Array(this.windowFrames);
    }

    /**
     * Feed the master tap's most recent chunks. The twin analysers of one
     * context always deliver equal lengths; non-finite samples read as silence,
     * the convention `measureIntegratedLoudness` applies at its own boundary.
     */
    push(left: Float32Array, right: Float32Array): void {
        const frameCount = Math.min(left.length, right.length);
        for (let index = 0; index < frameCount; index++) {
            const inLeft = left[index]!;
            const inRight = right[index]!;
            const weightedLeft = this.left.process(Number.isFinite(inLeft) ? inLeft : 0);
            const weightedRight = this.right.process(Number.isFinite(inRight) ? inRight : 0);

            this.sumSquaresLeft -= this.filteredLeft[this.writeIndex]! * this.filteredLeft[this.writeIndex]!;
            this.sumSquaresRight -= this.filteredRight[this.writeIndex]! * this.filteredRight[this.writeIndex]!;
            this.filteredLeft[this.writeIndex] = weightedLeft;
            this.filteredRight[this.writeIndex] = weightedRight;
            this.sumSquaresLeft += weightedLeft * weightedLeft;
            this.sumSquaresRight += weightedRight * weightedRight;

            this.writeIndex = (this.writeIndex + 1) % this.windowFrames;
            this.processedFrames++;
        }
    }

    /** True once the window holds nothing but programme, i.e. 400 ms have been pushed. */
    get filled(): boolean {
        return this.processedFrames >= this.windowFrames;
    }

    /**
     * K-weighted energy over the window — the `z` of the block loudness
     * formula, and what `ShortTermLUFS` accumulates. While the window is still
     * filling it divides by the full window length, so early readings ramp up
     * from silence the way the Rust twin's do.
     */
    get energy(): number {
        return (this.sumSquaresLeft + this.sumSquaresRight) / this.windowFrames;
    }

    /** Momentary loudness in LUFS, floored at the silence reading. */
    get value(): number {
        const energy = this.energy;
        if (!Number.isFinite(energy) || energy <= 0) {
            return SILENCE_LUFS;
        }
        return Math.max(SILENCE_LUFS, LOUDNESS_OFFSET + 10 * Math.log10(energy));
    }
}
