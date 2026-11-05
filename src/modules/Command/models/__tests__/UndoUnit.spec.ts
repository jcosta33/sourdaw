import { describe, expect, it } from 'vitest';

import { type UndoEntry } from '../UndoEntry';
import { isInertUndoUnit, newestUndoUnit, nextUndoUnit, partitionUndoUnits } from '../UndoUnit';

const ungrouped = {};
const inGroup = (groupId: string) => ({ groupId });

describe('partitionUndoUnits', () => {
    it('returns no units for an empty stack', () => {
        expect(partitionUndoUnits([])).toEqual([]);
    });

    it('makes every ungrouped entry its own unit', () => {
        expect(partitionUndoUnits([ungrouped, ungrouped, ungrouped])).toEqual([
            { first: 0, last: 0 },
            { first: 1, last: 1 },
            { first: 2, last: 2 },
        ]);
    });

    it('makes one contiguous group a single unit', () => {
        expect(partitionUndoUnits([inGroup('g'), inGroup('g'), inGroup('g')])).toEqual([{ first: 0, last: 2 }]);
    });

    it('splits two adjacent groups with different ids', () => {
        expect(partitionUndoUnits([inGroup('a'), inGroup('a'), inGroup('b'), inGroup('b'), inGroup('b')])).toEqual([
            { first: 0, last: 1 },
            { first: 2, last: 4 },
        ]);
    });

    it('keeps a group sandwiched between ungrouped entries as one unit', () => {
        expect(partitionUndoUnits([ungrouped, inGroup('g'), inGroup('g'), ungrouped])).toEqual([
            { first: 0, last: 0 },
            { first: 1, last: 2 },
            { first: 3, last: 3 },
        ]);
    });

    it('makes a non-contiguous reuse of one groupId two units', () => {
        expect(partitionUndoUnits([inGroup('g'), inGroup('g'), ungrouped, inGroup('g')])).toEqual([
            { first: 0, last: 1 },
            { first: 2, last: 2 },
            { first: 3, last: 3 },
        ]);
    });

    it('never joins entries whose groupId is empty', () => {
        expect(partitionUndoUnits([inGroup(''), inGroup('')])).toEqual([
            { first: 0, last: 0 },
            { first: 1, last: 1 },
        ]);
    });
});

describe('newestUndoUnit and nextUndoUnit', () => {
    const stack = [inGroup('a'), inGroup('a'), ungrouped, inGroup('b'), inGroup('b'), inGroup('b')];

    it('reports no unit for an empty stack', () => {
        expect(newestUndoUnit([])).toBeNull();
        expect(nextUndoUnit([])).toBeNull();
    });

    it('agree with the partition at both ends of the stack', () => {
        const units = partitionUndoUnits(stack);

        expect(newestUndoUnit(stack)).toEqual(units[units.length - 1]);
        expect(newestUndoUnit(stack)).toEqual({ first: 3, last: 5 });
        expect(nextUndoUnit(stack)).toEqual(units[0]);
        expect(nextUndoUnit(stack)).toEqual({ first: 0, last: 1 });
    });

    it('stop at an ungrouped neighbour', () => {
        expect(newestUndoUnit([inGroup('a'), ungrouped])).toEqual({ first: 1, last: 1 });
        expect(nextUndoUnit([ungrouped, inGroup('a')])).toEqual({ first: 0, last: 0 });
    });
});

describe('isInertUndoUnit', () => {
    const base = { label: 'x', timestamp: 0, source: 'manual' as const };
    const inert: UndoEntry = {
        ...base,
        id: 'i',
        kind: 'action',
        action: { type: 'togglePlayback' },
        inverseAction: null,
    };
    const reversible: UndoEntry = {
        ...base,
        id: 'r',
        kind: 'action',
        action: { type: 'togglePlayback' },
        inverseAction: { type: 'togglePlayback' },
    };
    const callback: UndoEntry = { ...base, id: 'c', kind: 'callback', undo: () => undefined, redo: () => undefined };

    it('holds only when every member is an action entry without an inverse', () => {
        expect(isInertUndoUnit([inert, inert])).toBe(true);
        expect(isInertUndoUnit([inert, reversible])).toBe(false);
        expect(isInertUndoUnit([inert, callback])).toBe(false);
    });
});
