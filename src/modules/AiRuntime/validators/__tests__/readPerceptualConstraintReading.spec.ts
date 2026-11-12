import { describe, expect, it } from 'vitest';

import { readPerceptualConstraintReading } from '../readPerceptualConstraintReading';

const lowEnd = {
    constraintId: 'low-end-untouched-v1',
    clause: "don't touch the low end",
    scope: { kind: 'mix' },
    protection: { kind: 'exclude-dimension', dimension: 'low-frequency-band' },
};
const notRaised = {
    constraintId: 'loudness-not-raised-v1',
    clause: "don't make it louder",
    scope: { kind: 'tracks', trackIds: ['drums'] },
    protection: { kind: 'measured' },
};
const unsupported = { constraintId: 'unsupported', clause: 'keep it warm', reason: 'No measurement shows it.' };

describe('reading a stored perceptual constraint reading', () => {
    it('reads a reading stored before measured holds existed exactly as it was written', () => {
        const stored = { constraints: [lowEnd], unsupported: [unsupported] };
        expect(readPerceptualConstraintReading(structuredClone(stored))).toEqual(stored);
    });

    it('reads a measured hold beside an exclusion', () => {
        const stored = { constraints: [lowEnd, notRaised], unsupported: [] };
        expect(readPerceptualConstraintReading(structuredClone(stored))).toEqual(stored);
    });

    it.each([
        ['an unknown protection kind', { ...notRaised, protection: { kind: 'advisory' } }],
        [
            'a measured protection on an exclusion id, which would let its excluded edit through',
            { ...lowEnd, protection: { kind: 'measured' } },
        ],
        [
            'an exclusion on a measured id',
            { ...notRaised, protection: { kind: 'exclude-dimension', dimension: 'ambience' } },
        ],
        ['an unknown id', { ...notRaised, constraintId: 'loudness-held-v2' }],
        ['a measured hold with no scope', { ...notRaised, scope: undefined }],
    ])('refuses the whole reading for %s', (_label, constraint) => {
        expect(readPerceptualConstraintReading({ constraints: [lowEnd, constraint], unsupported: [] })).toBeNull();
    });
});
