import { describe, it, expect, vi, beforeEach } from 'vitest';

type TimeSignatureChange = {
    id: string;
    beat: number;
    numerator: number;
    denominator: number;
};

type TimeSignatureMapStoreState = {
    changes: TimeSignatureChange[];
};

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = {
        value: { changes: [] as TimeSignatureChange[] } as TimeSignatureMapStoreState | null,
    };
    const setMock = vi.fn((next: typeof ref.value) => {
        ref.value = next;
    });
    return { setMock, mockStore: ref };
});

vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: {
        get value() {
            return mockStore.value;
        },
        set: setMock,
    },
}));

vi.mock('../../../models/TimeSignatureMap', () => ({
    createTimeSignatureChange: vi.fn((beat: number, numerator: number, denominator: number) => ({
        id: `ts-${beat}`,
        beat,
        numerator,
        denominator,
    })),
}));

import * as subject from '../addTimeSignatureChange';

describe('addTimeSignatureChange', () => {
    beforeEach(() => {
        mockStore.value = { changes: [] };
        setMock.mockClear();
    });

    it('should export addTimeSignatureChange', () => {
        expect(subject.addTimeSignatureChange).toBeDefined();
        const kind = typeof subject.addTimeSignatureChange;
        expect(kind === 'function' || kind === 'object').toBe(true);
    });

    it('is a no-op when the time-sig store has no state', () => {
        // Defensive guard: a null snapshot must not throw and must not call set.
        mockStore.value = null;
        subject.addTimeSignatureChange(0, 4, 4);
        expect(setMock).not.toHaveBeenCalled();
    });

    it('appends and sorts a new change at a beat with no existing entry', () => {
        mockStore.value = { changes: [{ id: 'ts-4', beat: 4, numerator: 3, denominator: 4 }] };
        subject.addTimeSignatureChange(8, 4, 4);
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes.map((c) => c.beat)).toEqual([4, 8]);
        expect(result.changes[1]).toEqual({ id: 'ts-8', beat: 8, numerator: 4, denominator: 4 });
    });

    it('inserts ahead of an existing later change and keeps the list beat-sorted', () => {
        mockStore.value = { changes: [{ id: 'ts-8', beat: 8, numerator: 4, denominator: 4 }] };
        subject.addTimeSignatureChange(2, 3, 8);
        const result = setMock.mock.calls[0]![0]!;
        // The new 3/8 change at beat 2 sorts before the existing beat-8 change.
        expect(result.changes.map((c) => c.beat)).toEqual([2, 8]);
    });

    it('updates an existing change at the same beat in place rather than duplicating', () => {
        // Exercises the `if (existing)` truthy arm and the map-then-return path.
        mockStore.value = {
            changes: [
                { id: 'ts-4', beat: 4, numerator: 4, denominator: 4 },
                { id: 'ts-8', beat: 8, numerator: 4, denominator: 4 },
            ],
        };
        subject.addTimeSignatureChange(4, 7, 8);
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes).toHaveLength(2);
        // The beat-4 entry is rewritten; the beat-8 entry is untouched.
        expect(result.changes[0]).toEqual({ id: 'ts-4', beat: 4, numerator: 7, denominator: 8 });
        expect(result.changes[1]).toEqual({ id: 'ts-8', beat: 8, numerator: 4, denominator: 4 });
    });

    it('updates the existing change within beat-epsilon instead of inserting a float-drift duplicate', () => {
        // Save/load can perturb a stored beat by a sub-tick amount; matching must
        // tolerate that drift the same way addTempoChange/removeTimeSignatureChange do.
        mockStore.value = {
            changes: [{ id: 'ts-5', beat: 5, numerator: 4, denominator: 4 }],
        };
        subject.addTimeSignatureChange(5.000000001, 3, 4);
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]).toEqual({ id: 'ts-5', beat: 5, numerator: 3, denominator: 4 });
    });
});
