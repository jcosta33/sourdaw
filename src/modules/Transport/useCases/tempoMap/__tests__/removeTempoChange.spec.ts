import { describe, it, expect, vi, beforeEach } from 'vitest';

type TempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

type TempoMapStoreState = {
    changes: TempoChange[];
};

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = {
        value: { changes: [] as TempoChange[] } as TempoMapStoreState | null,
    };
    const setMock = vi.fn((next: typeof ref.value) => {
        ref.value = next;
    });
    return { setMock, mockStore: ref };
});

vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return mockStore.value;
        },
        set: setMock,
    },
}));

import * as subject from '../removeTempoChange';

describe('removeTempoChange', () => {
    beforeEach(() => {
        mockStore.value = { changes: [] };
        setMock.mockClear();
    });

    it('should export removeTempoChange', () => {
        expect(subject.removeTempoChange).toBeDefined();
        const kind = typeof subject.removeTempoChange;
        expect(kind === 'function' || kind === 'object').toBe(true);
    });

    it('removes the change matching the given id and keeps the rest', () => {
        mockStore.value = {
            changes: [
                { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'b', beat: 8, tempo: 140, curve: 'linear' },
            ],
        };
        subject.removeTempoChange('a');
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes.map((c) => c.id)).toEqual(['b']);
    });

    it('is a no-op when the tempo map store has no state', () => {
        // Defensive guard against a null store snapshot: must not throw, must
        // not call set.
        mockStore.value = null;
        subject.removeTempoChange('a');
        expect(setMock).not.toHaveBeenCalled();
    });

    it('leaves an empty list when removing the only change', () => {
        mockStore.value = {
            changes: [{ id: 'a', beat: 0, tempo: 120, curve: 'instant' }],
        };
        subject.removeTempoChange('a');
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes).toEqual([]);
    });
});
