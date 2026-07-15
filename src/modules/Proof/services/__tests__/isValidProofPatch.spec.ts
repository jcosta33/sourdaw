import { describe, expect, it } from 'vitest';

import { DEFAULT_PATCH, type ProofPatch } from '../../models/ProofPatch';
import { isValidProofPatch } from '../isValidProofPatch';

type PatchMutation = (patch: ProofPatch) => void;

const invalidMutations: Array<[name: string, mutate: PatchMutation]> = [
    ['non-finite scalar', (patch) => (patch.inputGain = Number.POSITIVE_INFINITY)],
    ['limiter range', (patch) => (patch.limCeiling = 1)],
    ['EQ band range', (patch) => (patch.eqBands[2]!.freq = 1)],
    ['EQ band count', (patch) => patch.eqBands.pop()],
    ['dynamics band range', (patch) => (patch.dynBands[0]!.ratio = 0.5)],
    ['dynamics crossover order', (patch) => (patch.dynCrossoverFreqs = [1_000, 500, 8_000])],
    ['imager range', (patch) => (patch.imgBandWidth[0] = -0.1)],
    ['exciter type', (patch) => (patch.excBands[0]!.type = 4)],
    ['dither bit depth', (patch) => (patch.ditherBits = 20)],
    ['fixed target pairing', (patch) => (patch.targetLufs = -13)],
    ['chain permutation', (patch) => (patch.chainOrder = [0, 0, 1, 2, 3])],
    ['sparse chain order', (patch) => Reflect.deleteProperty(patch.chainOrder, 2)],
    ['sparse EQ bands', (patch) => Reflect.deleteProperty(patch.eqBands, 2)],
    ['sparse dynamics crossovers', (patch) => Reflect.deleteProperty(patch.dynCrossoverFreqs, 1)],
    ['sparse dynamics bands', (patch) => Reflect.deleteProperty(patch.dynBands, 1)],
    ['sparse imager widths', (patch) => Reflect.deleteProperty(patch.imgBandWidth, 1)],
    ['sparse exciter bands', (patch) => Reflect.deleteProperty(patch.excBands, 1)],
    ['null EQ band', (patch) => Reflect.set(patch.eqBands, 2, null)],
    ['undefined dynamics band', (patch) => Reflect.set(patch.dynBands, 1, undefined)],
    ['null exciter band', (patch) => Reflect.set(patch.excBands, 1, null)],
];

describe('isValidProofPatch', () => {
    it('accepts the default patch and a bounded custom target', () => {
        expect(isValidProofPatch(DEFAULT_PATCH)).toBe(true);
        expect(isValidProofPatch({ ...DEFAULT_PATCH, target: 'custom', targetLufs: -17.5 })).toBe(true);
    });

    it.each(invalidMutations)('rejects %s', (_name, mutate) => {
        const patch = structuredClone(DEFAULT_PATCH);
        mutate(patch);
        expect(isValidProofPatch(patch)).toBe(false);
    });
});
