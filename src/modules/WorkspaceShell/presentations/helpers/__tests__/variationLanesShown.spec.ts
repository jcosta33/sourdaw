import { describe, expect, it } from 'vitest';

import { findEnabledVariationLaneTrackIds, isSameVariationLanesShown } from '../variationLanesShown';

const shown = (entries: Array<[string, boolean]>): ReadonlyMap<string, boolean> => new Map(entries);

describe('findEnabledVariationLaneTrackIds', () => {
    it.each([
        ['the first observation only seeds the comparison', null, [['a', true]], []],
        ['a track whose lanes just switched on', [['a', false]], [['a', true]], ['a']],
        [
            'a track that appears with lanes already on',
            [['a', false]],
            [
                ['a', false],
                ['b', true],
            ],
            [],
        ],
        ['a track whose lanes switched off', [['a', true]], [['a', false]], []],
        ['lanes that stay on', [['a', true]], [['a', true]], []],
        [
            'only the switched track of several',
            [
                ['a', false],
                ['b', false],
            ],
            [
                ['a', true],
                ['b', false],
            ],
            ['a'],
        ],
    ] as const)('%s', (_name, previous, current, expected) => {
        const previousMap =
            previous === null ? null : shown([...previous.map(([id, on]): [string, boolean] => [id, on])]);
        const currentMap = shown(current.map(([id, on]): [string, boolean] => [id, on]));

        expect(findEnabledVariationLaneTrackIds(previousMap, currentMap)).toEqual(expected);
    });
});

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
