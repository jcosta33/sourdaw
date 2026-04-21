import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = {
        value: { changes: [] as { id: string; beat: number; numerator: number; denominator: number }[] } as {
            changes: { id: string; beat: number; numerator: number; denominator: number }[];
        } | null,
    };
    const setMock = vi.fn((next: typeof ref.value) => {
        ref.value = next;
    });
    return { setMock, mockStore: ref };
});

vi.mock('../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: {
        get value() {
            return mockStore.value;
        },
        set: setMock,
    },
}));

vi.mock('../../models/TimeSignatureMap', () => ({
    createTimeSignatureChange: vi.fn((beat: number, numerator: number, denominator: number) => ({
        id: `tsc-${beat}`,
        beat,
        numerator,
        denominator,
    })),
}));

import { addTimeSignatureChange } from '../timeSignatureChanges/addTimeSignatureChange';
import { getTimeSignatureChanges } from '../timeSignatureChanges/getTimeSignatureChanges';
import { removeTimeSignatureChange } from '../timeSignatureChanges/removeTimeSignatureChange';

describe('timeSignatureChanges', () => {
    beforeEach(() => {
        mockStore.value = { changes: [] };
        setMock.mockClear();
    });

    it('addTimeSignatureChange inserts and sorts by beat', () => {
        mockStore.value = { changes: [{ id: 'a', beat: 16, numerator: 4, denominator: 4 }] };
        addTimeSignatureChange(8, 3, 4);
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes.map((context) => context.beat)).toEqual([8, 16]);
    });

    it('addTimeSignatureChange replaces an entry at the same beat', () => {
        mockStore.value = { changes: [{ id: 'a', beat: 8, numerator: 4, denominator: 4 }] };
        addTimeSignatureChange(8, 6, 8);
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]!.numerator).toBe(6);
        expect(result.changes[0]!.denominator).toBe(8);
    });

    it('removeTimeSignatureChange filters by beat', () => {
        mockStore.value = {
            changes: [
                { id: 'a', beat: 0, numerator: 4, denominator: 4 },
                { id: 'b', beat: 8, numerator: 3, denominator: 4 },
            ],
        };
        removeTimeSignatureChange(0);
        expect(setMock.mock.calls[0]![0]!.changes.map((context) => context.beat)).toEqual([8]);
    });

    it('getTimeSignatureChanges returns the current changes (or empty)', () => {
        mockStore.value = null;
        expect(getTimeSignatureChanges()).toEqual([]);
        mockStore.value = { changes: [{ id: 'a', beat: 0, numerator: 4, denominator: 4 }] };
        expect(getTimeSignatureChanges()).toHaveLength(1);
    });
});
