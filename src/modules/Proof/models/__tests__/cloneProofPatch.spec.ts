import { describe, it, expect } from 'vitest';

import { cloneProofPatch, DEFAULT_PATCH, type ProofPatch } from '../ProofPatch';

/**
 * Every array and every band object a patch owns. `chainOrder` and the band
 * arrays are the parts a live device writes into, so each one must be its own
 * instance in every copy.
 */
const nestedInstances = (patch: ProofPatch): unknown[] => [
    patch.chainOrder,
    patch.eqBands,
    ...patch.eqBands,
    patch.dynCrossoverFreqs,
    patch.dynBands,
    ...patch.dynBands,
    patch.imgBandWidth,
    patch.excBands,
    ...patch.excBands,
];

describe('cloneProofPatch', () => {
    it('copies every value of the patch', () => {
        expect(cloneProofPatch(DEFAULT_PATCH)).toEqual(DEFAULT_PATCH);
    });

    it('shares no array or band object with the patch it copied', () => {
        const clone = cloneProofPatch(DEFAULT_PATCH);
        const originals = nestedInstances(DEFAULT_PATCH);

        for (const [index, copied] of nestedInstances(clone).entries()) {
            expect(copied).not.toBe(originals[index]);
        }
    });

    it('gives two clones of one patch separate bands', () => {
        const first = cloneProofPatch(DEFAULT_PATCH);
        const second = cloneProofPatch(DEFAULT_PATCH);

        for (const [index, instance] of nestedInstances(first).entries()) {
            expect(instance).not.toBe(nestedInstances(second)[index]);
        }
    });

    it('leaves the source untouched when the clone is edited', () => {
        // The defect this guards: a device editing its own EQ band rewrote the
        // shared DEFAULT_PATCH band, so every later device and every preset
        // built from the defaults started with another device's settings.
        const clone = cloneProofPatch(DEFAULT_PATCH);

        clone.eqBands[0]!.gain = 9;
        clone.dynBands[0]!.threshold = -3;
        clone.excBands[0]!.drive = 0.99;
        clone.imgBandWidth[0] = 1.75;
        clone.chainOrder[0] = 4;
        clone.dynCrossoverFreqs[0] = 250;

        expect(DEFAULT_PATCH.eqBands[0]!.gain).toBe(0);
        expect(DEFAULT_PATCH.dynBands[0]!.threshold).toBe(-20);
        expect(DEFAULT_PATCH.excBands[0]!.drive).toBe(0.2);
        expect(DEFAULT_PATCH.imgBandWidth[0]).toBe(0);
        expect(DEFAULT_PATCH.chainOrder[0]).toBe(0);
        expect(DEFAULT_PATCH.dynCrossoverFreqs[0]).toBe(120);
    });
});
