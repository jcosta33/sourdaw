import { describe, expect, it } from 'vitest';

import { isClipRestoreOrderSnapshot } from '../isClipRestoreOrderSnapshot';
import { resolveClipRestoreInsertionIndex } from '../resolveClipRestoreInsertionIndex';

const captured = { clipId: 'removed', clipIndex: 2, clipOrder: ['a', 'left', 'removed', 'right', 'c'] };
const clips = (...ids: string[]) => ids.map((id) => ({ id }));

describe('clip restore captured order', () => {
    it.each([
        { clipOrder: null },
        { clipOrder: undefined },
        { clipOrder: false },
        { clipOrder: {} },
        { clipOrder: [] },
        { clipOrder: ['removed'] },
        { clipOrder: ['a', 'a', 'removed'] },
        { clipOrder: ['a', '', 'removed'] },
        { clipOrder: ['a', 3, 'removed'] },
    ])('refuses a present malformed order $clipOrder', ({ clipOrder }) => {
        expect(isClipRestoreOrderSnapshot({ ...captured, clipOrder })).toBe(false);
    });
    it('refuses sparse witnesses and an index that does not identify the removed clip', () => {
        const order = ['a'];
        order[2] = 'removed';
        expect(isClipRestoreOrderSnapshot({ ...captured, clipOrder: order })).toBe(false);
        expect(isClipRestoreOrderSnapshot({ ...captured, clipIndex: 1 })).toBe(false);
        expect(isClipRestoreOrderSnapshot({ ...captured, clipIndex: 99 })).toBe(false);
    });
    it('retains numeric and append legacy admission when the order field is absent', () => {
        expect(isClipRestoreOrderSnapshot({ clipId: 'removed' })).toBe(true);
        expect(resolveClipRestoreInsertionIndex(clips('a', 'c'), { clipId: 'removed' })).toBe(2);
        expect(resolveClipRestoreInsertionIndex(clips('a', 'c'), { clipId: 'removed', clipIndex: 1 })).toBe(1);
    });
    it('uses farther surviving witnesses when both immediate neighbors disappear', () => {
        expect(resolveClipRestoreInsertionIndex(clips('peer-x', 'peer-y', 'peer-z', 'a', 'c'), captured)).toBe(4);
    });
    it('keeps the existing predecessor preference for a peer inserted in the gap', () => {
        expect(resolveClipRestoreInsertionIndex(clips('a', 'left', 'peer', 'right', 'c'), captured)).toBe(2);
    });
    it.each([
        ['c', 'a'],
        ['left', 'a', 'right', 'c'],
        ['a', 'left', 'c', 'right'],
        ['a', 'a', 'c'],
    ])('refuses nonmonotonic or duplicate surviving witnesses %j', (...ids) => {
        expect(resolveClipRestoreInsertionIndex(clips(...ids), captured)).toBeNull();
    });
});
