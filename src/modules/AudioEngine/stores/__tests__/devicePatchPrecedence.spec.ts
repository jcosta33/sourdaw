import { describe, expect, it } from 'vitest';

import { orderDevicePatchEntries } from '../devicePatchPrecedence';

describe('orderDevicePatchEntries', () => {
    it('replays a crust record style-first whatever order it was drawn in', () => {
        // Wrong-ordered records already exist: a crust record persisted before
        // the style/algorithm contract carries `algorithm` first.
        expect(orderDevicePatchEntries('crust', { algorithm: 6, style: 2 })).toEqual([
            ['style', 2],
            ['algorithm', 6],
        ]);
        expect(orderDevicePatchEntries('crust', { style: 2, algorithm: 6 })).toEqual([
            ['style', 2],
            ['algorithm', 6],
        ]);
    });

    it('replays a grinder record neuralEnabled-first ahead of engineMode', () => {
        expect(orderDevicePatchEntries('grinder', { engineMode: 1, neuralEnabled: 1, outputGain: 0 })).toEqual([
            ['neuralEnabled', 1],
            ['engineMode', 1],
            ['outputGain', 0],
        ]);
    });

    it('leads a gluten record with its macros in descriptor order ahead of the specific entries', () => {
        expect(
            orderDevicePatchEntries('gluten', {
                threshold: -12,
                style: 2,
                ratio: 6,
                topology: 1,
                amount: 40,
            })
        ).toEqual([
            ['topology', 1],
            ['style', 2],
            ['amount', 40],
            ['threshold', -12],
            ['ratio', 6],
        ]);
    });

    it('leaves devices without a law and records without the precedence keys untouched', () => {
        const record = { mix: 0.4, gain: 0.2 };
        expect(orderDevicePatchEntries('delay', record)).toEqual([
            ['mix', 0.4],
            ['gain', 0.2],
        ]);
        expect(orderDevicePatchEntries('crust', { ceiling: -0.3, gain: 3 })).toEqual([
            ['ceiling', -0.3],
            ['gain', 3],
        ]);
        expect(orderDevicePatchEntries('grinder', {})).toEqual([]);
    });
});
