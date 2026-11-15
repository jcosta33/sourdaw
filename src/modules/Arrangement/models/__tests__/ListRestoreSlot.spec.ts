import { describe, expect, it } from 'vitest';

import { insertAtListRestoreSlot, isValidListRestoreSlot, readListRestoreSlot } from '../ListRestoreSlot';

const row = (id: string) => ({ id });
const items = [row('a'), row('b'), row('c')];

describe('insertAtListRestoreSlot', () => {
    it.each([
        { label: 'no slot appends', slot: {}, expected: ['a', 'b', 'c', 'new'] },
        {
            label: 'before a present successor',
            slot: { beforeId: 'b', afterId: 'a', index: 0 },
            expected: ['a', 'new', 'b', 'c'],
        },
        {
            label: 'successor wins over predecessor',
            slot: { beforeId: 'c', afterId: 'a', index: 0 },
            expected: ['a', 'b', 'new', 'c'],
        },
        {
            label: 'after a present predecessor when the successor is gone',
            slot: { beforeId: 'x', afterId: 'b', index: 0 },
            expected: ['a', 'b', 'new', 'c'],
        },
        { label: 'predecessor alone', slot: { afterId: 'c' }, expected: ['a', 'b', 'c', 'new'] },
        {
            label: 'index when both anchors are gone',
            slot: { beforeId: 'x', afterId: 'y', index: 1 },
            expected: ['a', 'new', 'b', 'c'],
        },
        {
            label: 'index clamped to the list length',
            slot: { beforeId: 'x', index: 99 },
            expected: ['a', 'b', 'c', 'new'],
        },
        { label: 'index alone', slot: { index: 0 }, expected: ['new', 'a', 'b', 'c'] },
    ])('$label', ({ slot, expected }) => {
        expect(insertAtListRestoreSlot(items, row('new'), slot).map((item) => item.id)).toEqual(expected);
    });

    it('does not mutate the input list', () => {
        const input = [row('a')];
        insertAtListRestoreSlot(input, row('new'), { index: 0 });
        expect(input).toEqual([row('a')]);
    });
});

describe('readListRestoreSlot', () => {
    it.each([
        { index: 0, expected: { index: 0, beforeId: 'b' } },
        { index: 1, expected: { index: 1, beforeId: 'c', afterId: 'a' } },
        { index: 2, expected: { index: 2, afterId: 'b' } },
    ])('reads the neighbours of index $index', ({ index, expected }) => {
        expect(readListRestoreSlot(items, index)).toEqual(expected);
    });

    it('reads an only item as having no neighbours', () => {
        expect(readListRestoreSlot([row('a')], 0)).toEqual({ index: 0 });
    });
});

describe('isValidListRestoreSlot', () => {
    it.each([
        { slot: {}, valid: true },
        { slot: { index: 0, beforeId: 'x', afterId: 'y' }, valid: true },
        { slot: { beforeId: 'names-no-item' }, valid: true },
        { slot: { index: -1 }, valid: false },
        { slot: { index: 1.5 }, valid: false },
        { slot: { index: Number.NaN }, valid: false },
        { slot: { index: '1' }, valid: false },
        { slot: { beforeId: 7 }, valid: false },
        { slot: { afterId: {} }, valid: false },
        { slot: { beforeId: null }, valid: false },
    ])('returns $valid for $slot', ({ slot, valid }) => {
        expect(isValidListRestoreSlot(slot)).toBe(valid);
    });
});
