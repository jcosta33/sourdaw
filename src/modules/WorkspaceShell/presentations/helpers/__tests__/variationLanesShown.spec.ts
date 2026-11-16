import { describe, expect, it } from 'vitest';

import { isSameVariationLanesShown } from '../variationLanesShown';

const shown = (entries: Array<[string, boolean]>): ReadonlyMap<string, boolean> => new Map(entries);

describe('isSameVariationLanesShown', () => {
    it.each([
        ['equal maps', [['a', true]], [['a', true]], true],
        ['a flipped track', [['a', true]], [['a', false]], false],
        [
            'an added track',
            [['a', true]],
            [
                ['a', true],
                ['b', false],
            ],
            false,
        ],
        ['a replaced track id', [['a', true]], [['b', true]], false],
    ] as const)('%s', (_name, a, b, expected) => {
        expect(
            isSameVariationLanesShown(
                shown(a.map(([id, on]): [string, boolean] => [id, on])),
                shown(b.map(([id, on]): [string, boolean] => [id, on]))
            )
        ).toBe(expected);
    });
});
