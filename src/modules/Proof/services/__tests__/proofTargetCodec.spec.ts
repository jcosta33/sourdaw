import { describe, expect, it } from 'vitest';

import { type ProofTarget } from '../../models/ProofPatch';
import { proofTargetFromInt, proofTargetToInt } from '../proofTargetCodec';

const TARGET_CODEC_CASES = [
    ['streaming', 0],
    ['cd', 1],
    ['club', 2],
    ['broadcast', 3],
    ['podcast', 4],
    ['custom', 5],
] as const satisfies readonly (readonly [ProofTarget, number])[];

describe('proofTargetCodec', () => {
    it.each(TARGET_CODEC_CASES)('round-trips %s as %i', (target, encoded) => {
        expect(proofTargetToInt(target)).toBe(encoded);
        expect(proofTargetFromInt(encoded)).toBe(target);
    });

    it.each([undefined, -1, 6, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects invalid encoded target %s',
        (encoded) => {
            expect(proofTargetFromInt(encoded)).toBeNull();
        }
    );
});
