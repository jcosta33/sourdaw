import { describe, expect, it } from 'vitest';

import { LOUDNESS_OFFSET } from '#/utils/audioMetering/loudnessScale';

import { ShortTermLUFS } from '../ShortTermLUFS';

/**
 * The short-term meter accumulates K-weighted 400 ms block energies (the `z`
 * `MomentaryLUFS.energy` produces) and averages them in the energy domain,
 * producing the decibel figure once on the way out — the order of operations
 * BS.1770-4 specifies. These specs build blocks from their target loudness the
 * same way the formula inverts.
 */

/** The block energy whose loudness reads `lufs` under the BS.1770-4 formula. */
function blockEnergyFor(lufs: number): number {
    return 10 ** ((lufs - LOUDNESS_OFFSET) / 10);
}

describe('ShortTermLUFS', () => {
    it('averages eight 400 ms block energies over the three-second window', () => {
        const meter = new ShortTermLUFS();
        for (let index = 0; index < 8; index++) {
            meter.push(blockEnergyFor(-10));
        }
        expect(meter.value).toBeCloseTo(-10, 1);
    });

    it('averages mixed blocks in the energy domain, not decibels', () => {
        // Energy mean of four -10 and four -20 blocks:
        // -0.691 + 10·log10((4·10^(-0.9309) + 4·10^(-1.9309))/8) ≈ -12.6.
        // Averaging the decibel values instead would read -15.
        const meter = new ShortTermLUFS();
        for (let index = 0; index < 4; index++) {
            meter.push(blockEnergyFor(-10));
            meter.push(blockEnergyFor(-20));
        }
        expect(meter.value).toBeCloseTo(-12.6, 1);
    });

    it('shifts out the oldest block once the eight-block ring is full', () => {
        const meter = new ShortTermLUFS();
        meter.push(blockEnergyFor(-100)); // shifts out after eight more blocks
        for (let index = 0; index < 8; index++) {
            meter.push(blockEnergyFor(-10));
        }
        expect(meter.value).toBeCloseTo(-10, 1);
    });

    it('keeps the last three seconds after many pushes', () => {
        const meter = new ShortTermLUFS();
        for (let index = 0; index < 8; index++) {
            meter.push(blockEnergyFor(-10));
        }
        meter.push(blockEnergyFor(-40));
        // Seven -10 blocks and one -40 block remain: ≈ -10.58.
        expect(meter.value).toBeCloseTo(-10.58, 1);
    });

    it('returns -70 when nothing has been pushed', () => {
        const meter = new ShortTermLUFS();
        expect(meter.value).toBe(-70);
    });

    it('floors the output at -70 for near-silence energies', () => {
        const meter = new ShortTermLUFS();
        meter.push(blockEnergyFor(-200));
        expect(meter.value).toBe(-70);
    });
});
